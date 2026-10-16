import { kindOf, type LedgerEvent } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** What a new event looks like before the store assigns id and recordedAt; `kind` derives from `type`. */
export type NewLedgerEvent = Omit<LedgerEvent, 'id' | 'recordedAt' | 'kind'> & { kind?: LedgerEvent['kind'] };

/**
 * Accounts that keep a running balance (perf item 13): a driver's earnings (`driver:`) and the cash
 * he holds (`cash:`), read once per nearby driver per dispatch wave by the cap check. Per-driver
 * accounts only, so keeping them never serialises postings of different drivers. Keep in step with
 * `ledger_balance_projected` in migration 20261010270000_driver_running_balance.
 */
export function isProjectedAccount(accountId: string): boolean {
  return accountId.startsWith('driver:') || accountId.startsWith('cash:');
}

/** A projected account's running balance: the same `amount` and `events` the full-history sum gives. */
export interface RunningBalance {
  amount: number;
  events: number;
}

/**
 * Append-only store. There is deliberately no update or delete:
 * balances are computed from events and corrections are new `adjustment` events.
 * Writes take the unit-of-work `Tx` so a posting group commits with the caller's aggregate and outbox.
 */
export interface LedgerRepository {
  append(event: NewLedgerEvent, tx?: Tx): Promise<LedgerEvent>;
  /** Appends every event or none (the caller validated the whole batch first). */
  appendMany(events: readonly NewLedgerEvent[], tx?: Tx): Promise<LedgerEvent[]>;
  /** Events touching an account (as source or destination), oldest first; inside `tx` when given. */
  byAccount(accountId: string, tx?: Tx): Promise<LedgerEvent[]>;
  /**
   * SCALE-16: an account's signed sum and line count (lines before `before` only, when given), added
   * up by the store instead of loading the history; inside `tx` when given.
   */
  sumFor(accountId: string, before?: Date, tx?: Tx): Promise<RunningBalance>;
  /** SCALE-16: the account's lines of these `types` and/or at or after `since`, oldest first. */
  byAccountWhere(accountId: string, where: { types?: readonly LedgerEvent['type'][]; since?: Date }): Promise<LedgerEvent[]>;
  /**
   * SCALE-16: the newest `take` lines of an account before `before`, oldest first, widened so the
   * oldest timestamp is never split (a posting group's lines share one timestamp, so no group is
   * cut). `complete`: nothing older exists.
   */
  byAccountPage(accountId: string, page: { before?: Date | undefined; take: number }): Promise<{ events: LedgerEvent[]; complete: boolean }>;
  byTrip(tripId: string): Promise<LedgerEvent[]>;
  byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]>;
  /** Lines carrying this order id, oldest first (support case view). */
  byOrder(orderId: string): Promise<LedgerEvent[]>;
  /** Lines of these types that occurred in `[from, to)`, oldest first (finance desk: today's hand-overs). */
  byTypesBetween(types: readonly LedgerEvent['type'][], from: Date, to: Date): Promise<LedgerEvent[]>;
  all(): Promise<LedgerEvent[]>;
  findByIdempotencyKey(key: string, tx?: Tx): Promise<LedgerEvent | undefined>;
  /**
   * Running balance of a projected account, kept in the same transaction as every append (one row,
   * no history read). `undefined` when the account is not projected or this store keeps none; a
   * projected account with no lines yet is `{ amount: 0, events: 0 }`.
   */
  runningBalance(accountId: string, tx?: Tx): Promise<RunningBalance | undefined>;
  /** Every stored running balance (nightly check), or `undefined` when this store keeps none. */
  runningBalances(): Promise<Map<string, RunningBalance> | undefined>;
  /**
   * Resets one projected account's running balance to its full-history sum, holding the account's
   * row lock so a posting landing at the same moment is neither lost nor counted twice. Returns the
   * stored value before and the value after.
   */
  repairRunningBalance(accountId: string): Promise<{ before: RunningBalance; after: RunningBalance }>;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly events: LedgerEvent[] = [];
  private seq = 0;
  // Indexes (the simulator posts tens of thousands of rows): same answers as a scan, oldest first.
  private readonly byKey = new Map<string, LedgerEvent>();
  private readonly byAccountIdx = new Map<string, LedgerEvent[]>();
  private readonly byTripIdx = new Map<string, LedgerEvent[]>();
  private readonly byGroupIdx = new Map<string, LedgerEvent[]>();
  private readonly running = new Map<string, RunningBalance>();

  private applyRunning(account: string, delta: number): void {
    if (!isProjectedAccount(account)) return;
    const cur = this.running.get(account) ?? { amount: 0, events: 0 };
    this.running.set(account, { amount: cur.amount + delta, events: cur.events + 1 });
  }

  private index(e: LedgerEvent): void {
    const add = (m: Map<string, LedgerEvent[]>, k: string | undefined) => {
      if (k === undefined) return;
      const list = m.get(k);
      if (list) list.push(e);
      else m.set(k, [e]);
    };
    if (e.idempotencyKey && !this.byKey.has(e.idempotencyKey)) this.byKey.set(e.idempotencyKey, e);
    add(this.byAccountIdx, e.fromAccount);
    if (e.toAccount !== e.fromAccount) add(this.byAccountIdx, e.toAccount);
    add(this.byTripIdx, e.tripId);
    add(this.byGroupIdx, e.postingGroupId);
    this.applyRunning(e.toAccount, e.amount);
    this.applyRunning(e.fromAccount, -e.amount);
  }

  async append(event: NewLedgerEvent): Promise<LedgerEvent> {
    const [stored] = await this.appendMany([event]);
    return stored!;
  }

  async appendMany(events: readonly NewLedgerEvent[]): Promise<LedgerEvent[]> {
    const out: LedgerEvent[] = [];
    const staged: LedgerEvent[] = [];
    for (const event of events) {
      if (event.idempotencyKey) {
        const existing = this.byKey.get(event.idempotencyKey) ?? staged.find((e) => e.idempotencyKey === event.idempotencyKey);
        if (existing) {
          out.push(existing);
          continue;
        }
      }
      this.seq += 1;
      const stored: LedgerEvent = Object.freeze({
        ...event,
        kind: event.kind ?? kindOf(event.type),
        id: `le_${this.seq}`,
        recordedAt: new Date(),
      });
      staged.push(stored);
      out.push(stored);
    }
    this.events.push(...staged);
    for (const e of staged) this.index(e);
    return out;
  }

  async byAccount(accountId: string): Promise<LedgerEvent[]> {
    return [...(this.byAccountIdx.get(accountId) ?? [])];
  }

  async sumFor(accountId: string, before?: Date): Promise<RunningBalance> {
    let amount = 0;
    let events = 0;
    for (const e of this.byAccountIdx.get(accountId) ?? []) {
      if (before && e.occurredAt.getTime() >= before.getTime()) continue;
      amount += (e.toAccount === accountId ? e.amount : 0) - (e.fromAccount === accountId ? e.amount : 0);
      events += 1;
    }
    return { amount, events };
  }

  async byAccountWhere(accountId: string, where: { types?: readonly LedgerEvent['type'][]; since?: Date }): Promise<LedgerEvent[]> {
    const types = where.types ? new Set<string>(where.types) : null;
    return (this.byAccountIdx.get(accountId) ?? []).filter((e) => (!types || types.has(e.type)) && (!where.since || e.occurredAt.getTime() >= where.since.getTime()));
  }

  async byAccountPage(accountId: string, page: { before?: Date | undefined; take: number }): Promise<{ events: LedgerEvent[]; complete: boolean }> {
    const older = (this.byAccountIdx.get(accountId) ?? [])
      .filter((e) => !page.before || e.occurredAt.getTime() < page.before.getTime())
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    if (older.length <= page.take) return { events: older, complete: true };
    let start = older.length - page.take;
    const floor = older[start]!.occurredAt.getTime();
    while (start > 0 && older[start - 1]!.occurredAt.getTime() === floor) start -= 1;
    return { events: older.slice(start), complete: start === 0 };
  }

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    return [...(this.byTripIdx.get(tripId) ?? [])];
  }

  async byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]> {
    // Recording order across groups (ids are `le_<seq>`), as a scan would return them.
    const seqOf = (e: LedgerEvent) => Number(e.id.slice(3));
    return [...new Set(groupIds)].flatMap((id) => this.byGroupIdx.get(id) ?? []).sort((a, b) => seqOf(a) - seqOf(b));
  }

  async byOrder(orderId: string): Promise<LedgerEvent[]> {
    return this.events.filter((e) => e.orderId === orderId);
  }

  async byTypesBetween(types: readonly LedgerEvent['type'][], from: Date, to: Date): Promise<LedgerEvent[]> {
    const set = new Set<string>(types);
    return this.events.filter((e) => set.has(e.type) && e.occurredAt.getTime() >= from.getTime() && e.occurredAt.getTime() < to.getTime());
  }

  async all(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined> {
    return this.byKey.get(key);
  }

  async runningBalance(accountId: string): Promise<RunningBalance | undefined> {
    if (!isProjectedAccount(accountId)) return undefined;
    return { ...(this.running.get(accountId) ?? { amount: 0, events: 0 }) };
  }

  async runningBalances(): Promise<Map<string, RunningBalance>> {
    return new Map([...this.running].map(([k, v]) => [k, { ...v }]));
  }

  async repairRunningBalance(accountId: string): Promise<{ before: RunningBalance; after: RunningBalance }> {
    const before = { ...(this.running.get(accountId) ?? { amount: 0, events: 0 }) };
    const events = this.byAccountIdx.get(accountId) ?? [];
    let amount = 0;
    for (const e of events) amount += (e.toAccount === accountId ? e.amount : 0) - (e.fromAccount === accountId ? e.amount : 0);
    const after = { amount, events: events.length };
    this.running.set(accountId, after);
    return { before, after: { ...after } };
  }
}
