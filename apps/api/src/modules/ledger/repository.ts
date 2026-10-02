import type { LedgerEvent } from '@driver/contracts';

/** What a new event looks like before the store assigns id and recordedAt. */
export type NewLedgerEvent = Omit<LedgerEvent, 'id' | 'recordedAt'>;

/**
 * Append-only store. There is deliberately no update or delete:
 * balances are computed from events and corrections are new `adjustment` events.
 */
export interface LedgerRepository {
  append(event: NewLedgerEvent): Promise<LedgerEvent>;
  /** Events touching an account (as source or destination), oldest first. */
  byAccount(accountId: string): Promise<LedgerEvent[]>;
  byTrip(tripId: string): Promise<LedgerEvent[]>;
  all(): Promise<LedgerEvent[]>;
  findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined>;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly events: LedgerEvent[] = [];
  private seq = 0;

  async append(event: NewLedgerEvent): Promise<LedgerEvent> {
    if (event.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(event.idempotencyKey);
      if (existing) return existing;
    }
    this.seq += 1;
    const stored: LedgerEvent = Object.freeze({ ...event, id: `le_${this.seq}`, recordedAt: new Date() });
    this.events.push(stored);
    return stored;
  }

  async byAccount(accountId: string): Promise<LedgerEvent[]> {
    return this.events.filter((e) => e.fromAccount === accountId || e.toAccount === accountId);
  }

  async byTrip(tripId: string): Promise<LedgerEvent[]> {
    return this.events.filter((e) => e.tripId === tripId);
  }

  async all(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEvent | undefined> {
    return this.events.find((e) => e.idempotencyKey === key);
  }
}
