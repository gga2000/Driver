import { kindOf, type LedgerEvent } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { isProjectedAccount, type LedgerRepository, type NewLedgerEvent, type RunningBalance } from './repository.js';

/**
 * The subset of the generated Prisma client this repository needs. Declaring it structurally
 * keeps the ledger module testable without a database and keeps `@driver/db` types out of
 * the public interface. Only `create` and `findMany` exist here on purpose: the table is
 * append-only and no code path may update or delete a ledger row.
 */
export interface LedgerEventDelegate {
  create(args: { data: LedgerRow }): Promise<LedgerRow & { id: string; recordedAt: Date }>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: { occurredAt: 'asc' | 'desc' };
  }): Promise<Array<LedgerRow & { id: string; recordedAt: Date }>>;
  findUnique(args: { where: { idempotencyKey: string } }): Promise<(LedgerRow & { id: string; recordedAt: Date }) | null>;
}

interface LedgerRow {
  kind: LedgerEvent['kind'];
  type: LedgerEvent['type'];
  amountIqd: number;
  currency: string;
  fromAccount: string;
  toAccount: string;
  tripId?: string | null;
  orderId?: string | null;
  routeId?: string | null;
  departureId?: string | null;
  postingGroupId?: string | null;
  idempotencyKey?: string | null;
  memo?: string | null;
  occurredAt: Date;
}

/** Tagged-template raw SQL, as the Prisma client and its transaction client offer it. */
export interface RawSqlClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface RawSqlRunner extends RawSqlClient {
  $transaction<T>(fn: (tx: RawSqlClient) => Promise<T>): Promise<T>;
}

/**
 * `ledger_balances` (perf item 13). The database keeps it: the `ledger_balances_apply` trigger adds
 * every inserted `ledger_events` line to its driver accounts in the same transaction, whatever wrote
 * the line, so this class only reads it and, for the nightly check, repairs it.
 */
export class PrismaLedgerBalanceStore {
  constructor(private readonly db: RawSqlRunner) {}

  async find(accountId: string): Promise<RunningBalance | undefined> {
    const rows = await this.db.$queryRaw<Array<{ amount: number; events: number }>>`
      SELECT "amount_iqd" AS amount, "events" FROM "public"."ledger_balances" WHERE "account_id" = ${accountId}`;
    return rows[0] ? { amount: rows[0].amount, events: rows[0].events } : undefined;
  }

  async all(): Promise<Map<string, RunningBalance>> {
    const rows = await this.db.$queryRaw<Array<{ account: string; amount: number; events: number }>>`
      SELECT "account_id" AS account, "amount_iqd" AS amount, "events" FROM "public"."ledger_balances"`;
    return new Map(rows.map((r) => [r.account, { amount: r.amount, events: r.events }]));
  }

  /**
   * Under READ COMMITTED: the first statement takes the account's row lock (creating the row if
   * missing), so any posting already holding it commits first; the sum then runs on a fresh snapshot
   * that includes it, and any later posting waits for this commit and adds on top.
   */
  async repair(accountId: string): Promise<{ before: RunningBalance; after: RunningBalance }> {
    return this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ amount: number; events: number }>>`
        INSERT INTO "public"."ledger_balances" ("id", "account_id", "amount_iqd", "events", "updated_at")
        VALUES (gen_random_uuid()::TEXT, ${accountId}, 0, 0, CURRENT_TIMESTAMP)
        ON CONFLICT ("account_id") DO UPDATE SET "account_id" = EXCLUDED."account_id"
        RETURNING "amount_iqd" AS amount, "events"`;
      const [full] = await tx.$queryRaw<Array<{ amount: number; events: number }>>`
        SELECT COALESCE(SUM(CASE WHEN "to_account" = ${accountId} THEN "amount_iqd" ELSE -"amount_iqd" END), 0)::INT AS amount,
               COUNT(*)::INT AS events
        FROM "public"."ledger_events" WHERE "to_account" = ${accountId} OR "from_account" = ${accountId}`;
      await tx.$queryRaw`
        UPDATE "public"."ledger_balances" SET "amount_iqd" = ${full!.amount}, "events" = ${full!.events}, "updated_at" = CURRENT_TIMESTAMP
        WHERE "account_id" = ${accountId} RETURNING "id"`;
      return { before: { amount: locked!.amount, events: locked!.events }, after: { amount: full!.amount, events: full!.events } };
    });
  }
}

export class PrismaLedgerRepository implements LedgerRepository {
  /** `balances` absent (tests with a bare delegate): every balance read sums the full history. */
  constructor(
    private readonly delegate: LedgerEventDelegate,
    private readonly balances?: PrismaLedgerBalanceStore,
  ) {}

  async runningBalance(accountId: string): Promise<RunningBalance | undefined> {
    if (!this.balances || !isProjectedAccount(accountId)) return undefined;
    return (await this.balances.find(accountId)) ?? { amount: 0, events: 0 };
  }

  async runningBalances(): Promise<Map<string, RunningBalance> | undefined> {
    return this.balances?.all();
  }

  async repairRunningBalance(accountId: string): Promise<{ before: RunningBalance; after: RunningBalance }> {
    if (!this.balances) throw new Error('ledger_balances is not configured');
    return this.balances.repair(accountId);
  }

  /** Inside a unit of work, write through the transaction's delegate so the group commits with it. */
  private db(tx?: Tx): LedgerEventDelegate {
    const scoped = (tx as unknown as { ledgerEvent?: LedgerEventDelegate } | undefined)?.ledgerEvent;
    return scoped ?? this.delegate;
  }

  async append(event: NewLedgerEvent, tx?: Tx): Promise<LedgerEvent> {
    const [stored] = await this.appendMany([event], tx);
    return stored!;
  }

  async appendMany(events: readonly NewLedgerEvent[], tx?: Tx): Promise<LedgerEvent[]> {
    const db = this.db(tx);
    const out: LedgerEvent[] = [];
    for (const event of events) {
      if (event.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(event.idempotencyKey, tx);
        if (existing) {
          out.push(existing);
          continue;
        }
      }
      out.push(fromRow(await db.create({ data: toRow(event) })));
    }
    return out;
  }

  async byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]> {
    if (groupIds.length === 0) return [];
    const rows = await this.delegate.findMany({ where: { postingGroupId: { in: [...groupIds] } }, orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async byAccount(accountId: string, tx?: Tx): Promise<LedgerEvent[]> {
    const rows = await this.db(tx).findMany({
      where: { OR: [{ fromAccount: accountId }, { toAccount: accountId }] },
      orderBy: { occurredAt: 'asc' },
    });
    return rows.map(fromRow);
  }

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ where: { tripId }, orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async byOrder(orderId: string): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ where: { orderId }, orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async byTypesBetween(types: readonly LedgerEvent['type'][], from: Date, to: Date): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ where: { type: { in: [...types] }, occurredAt: { gte: from, lt: to } }, orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async all(): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async findByIdempotencyKey(key: string, tx?: Tx): Promise<LedgerEvent | undefined> {
    const row = await this.db(tx).findUnique({ where: { idempotencyKey: key } });
    return row ? fromRow(row) : undefined;
  }
}

function toRow(e: NewLedgerEvent): LedgerRow {
  return {
    kind: e.kind ?? kindOf(e.type),
    type: e.type,
    amountIqd: e.amount,
    currency: e.currency,
    fromAccount: e.fromAccount,
    toAccount: e.toAccount,
    tripId: e.tripId ?? null,
    orderId: e.orderId ?? null,
    routeId: e.routeId ?? null,
    departureId: e.departureId ?? null,
    postingGroupId: e.postingGroupId ?? null,
    idempotencyKey: e.idempotencyKey ?? null,
    memo: e.memo ?? null,
    occurredAt: e.occurredAt,
  };
}

function fromRow(r: LedgerRow & { id: string; recordedAt: Date }): LedgerEvent {
  return {
    id: r.id,
    kind: r.kind,
    type: r.type,
    amount: r.amountIqd,
    currency: 'IQD',
    fromAccount: r.fromAccount,
    toAccount: r.toAccount,
    tripId: r.tripId ?? undefined,
    orderId: r.orderId ?? undefined,
    routeId: r.routeId ?? undefined,
    departureId: r.departureId ?? undefined,
    postingGroupId: r.postingGroupId ?? undefined,
    idempotencyKey: r.idempotencyKey ?? undefined,
    memo: r.memo ?? undefined,
    occurredAt: r.occurredAt,
    recordedAt: r.recordedAt,
  };
}
