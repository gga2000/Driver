import { kindOf, type LedgerEvent } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** What a new event looks like before the store assigns id and recordedAt; `kind` derives from `type`. */
export type NewLedgerEvent = Omit<LedgerEvent, 'id' | 'recordedAt' | 'kind'> & { kind?: LedgerEvent['kind'] };

/**
 * Append-only store. There is deliberately no update or delete:
 * balances are computed from events and corrections are new `adjustment` events.
 * Writes take the unit-of-work `Tx` so a posting group commits with the caller's aggregate and outbox.
 */
export interface LedgerRepository {
  append(event: NewLedgerEvent, tx?: Tx): Promise<LedgerEvent>;
  /** Appends every event or none (the caller validated the whole batch first). */
  appendMany(events: readonly NewLedgerEvent[], tx?: Tx): Promise<LedgerEvent[]>;
  /** Events touching an account (as source or destination), oldest first. */
  byAccount(accountId: string): Promise<LedgerEvent[]>;
  byTrip(tripId: string): Promise<LedgerEvent[]>;
  byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]>;
  all(): Promise<LedgerEvent[]>;
  findByIdempotencyKey(key: string, tx?: Tx): Promise<LedgerEvent | undefined>;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly events: LedgerEvent[] = [];
  private seq = 0;
  // Indexes (the simulator posts tens of thousands of rows): same answers as a scan, oldest first.
  private readonly byKey = new Map<string, LedgerEvent>();
  private readonly byAccountIdx = new Map<string, LedgerEvent[]>();
  private readonly byTripIdx = new Map<string, LedgerEvent[]>();
  private readonly byGroupIdx = new Map<string, LedgerEvent[]>();

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

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    return [...(this.byTripIdx.get(tripId) ?? [])];
  }

  async byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]> {
    // Recording order across groups (ids are `le_<seq>`), as a scan would return them.
    const seqOf = (e: LedgerEvent) => Number(e.id.slice(3));
    return [...new Set(groupIds)].flatMap((id) => this.byGroupIdx.get(id) ?? []).sort((a, b) => seqOf(a) - seqOf(b));
  }

  async all(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined> {
    return this.byKey.get(key);
  }
}
