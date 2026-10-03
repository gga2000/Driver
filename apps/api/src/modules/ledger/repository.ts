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

  async append(event: NewLedgerEvent): Promise<LedgerEvent> {
    const [stored] = await this.appendMany([event]);
    return stored!;
  }

  async appendMany(events: readonly NewLedgerEvent[]): Promise<LedgerEvent[]> {
    const out: LedgerEvent[] = [];
    const staged: LedgerEvent[] = [];
    for (const event of events) {
      if (event.idempotencyKey) {
        const existing = this.events.find((e) => e.idempotencyKey === event.idempotencyKey) ?? staged.find((e) => e.idempotencyKey === event.idempotencyKey);
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
    return out;
  }

  async byAccount(accountId: string): Promise<LedgerEvent[]> {
    return this.events.filter((e) => e.fromAccount === accountId || e.toAccount === accountId);
  }

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    return this.events.filter((e) => e.tripId === tripId);
  }

  async byPostingGroups(groupIds: readonly string[]): Promise<LedgerEvent[]> {
    const ids = new Set(groupIds);
    return this.events.filter((e) => e.postingGroupId !== undefined && ids.has(e.postingGroupId));
  }

  async all(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined> {
    return this.events.find((e) => e.idempotencyKey === key);
  }
}
