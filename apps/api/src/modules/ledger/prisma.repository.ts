import { kindOf, type LedgerEvent } from '@driver/contracts';
import type { LedgerRepository, NewLedgerEvent } from './repository.js';

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

export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly delegate: LedgerEventDelegate) {}

  async append(event: NewLedgerEvent): Promise<LedgerEvent> {
    if (event.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(event.idempotencyKey);
      if (existing) return existing;
    }
    const row = await this.delegate.create({ data: toRow(event) });
    return fromRow(row);
  }

  async byAccount(accountId: string): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({
      where: { OR: [{ fromAccount: accountId }, { toAccount: accountId }] },
      orderBy: { occurredAt: 'asc' },
    });
    return rows.map(fromRow);
  }

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ where: { tripId }, orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async all(): Promise<LedgerEvent[]> {
    const rows = await this.delegate.findMany({ orderBy: { occurredAt: 'asc' } });
    return rows.map(fromRow);
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined> {
    const row = await this.delegate.findUnique({ where: { idempotencyKey: key } });
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
