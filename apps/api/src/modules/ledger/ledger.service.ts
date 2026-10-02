import { Inject, Injectable } from '@nestjs/common';
import type { LedgerEvent } from '@driver/contracts';
import { LEDGER_REPOSITORY } from './tokens.js';
import type { LedgerRepository, NewLedgerEvent } from './repository.js';

/** Typed account ids (spec §8). */
export const Accounts = {
  platform: 'platform' as const,
  driver: (id: string) => `driver:${id}` as const,
  /** Cash physically held by a driver; the credit cap is a rule on this balance. */
  cash: (driverId: string) => `cash:${driverId}` as const,
  merchant: (id: string) => `merchant:${id}` as const,
  customer: (id: string) => `customer:${id}` as const,
  /** Outside world: payouts leave the system here. */
  bank: 'bank' as const,
};

export interface Balance {
  accountId: string;
  /** Sum of inflows minus outflows, in IQD. */
  amount: number;
  events: number;
}

export interface Invariant {
  ok: boolean;
  /** Σ(inflows) − Σ(outflows) across all accounts; must be exactly 0. */
  net: number;
  events: number;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(LEDGER_REPOSITORY) private readonly repo: LedgerRepository) {}

  /** Append a money event. Amount must be positive; direction is from → to. */
  async record(event: Omit<NewLedgerEvent, 'currency'> & { currency?: 'IQD' }): Promise<LedgerEvent> {
    if (!Number.isInteger(event.amount) || event.amount <= 0) {
      throw new LedgerError('invalid_amount', `amount must be a positive integer IQD, got ${event.amount}`);
    }
    if (event.fromAccount === event.toAccount) {
      throw new LedgerError('same_account', `same account on both sides: ${event.fromAccount}`);
    }
    return this.repo.append({ ...event, currency: 'IQD' });
  }

  /** Balance is computed, never stored. */
  async balance(accountId: string): Promise<Balance> {
    const events = await this.repo.byAccount(accountId);
    return { accountId, amount: sumFor(accountId, events), events: events.length };
  }

  /** Driver credit cap rule: cash held ≥ cap blocks new offers after the current job. */
  async isOverCap(driverId: string, capIqd: number): Promise<boolean> {
    const { amount } = await this.balance(Accounts.cash(driverId));
    return amount >= capIqd;
  }

  async eventsForTrip(tripId: string): Promise<LedgerEvent[]> {
    return this.repo.byTrip(tripId);
  }

  /** Double-entry invariant: every event moves value from one account to another, so the net is zero. */
  async checkInvariant(): Promise<Invariant> {
    const events = await this.repo.all();
    const accounts = new Set<string>();
    for (const e of events) {
      accounts.add(e.fromAccount);
      accounts.add(e.toAccount);
    }
    let net = 0;
    for (const a of accounts) net += sumFor(a, events);
    return { ok: net === 0, net, events: events.length };
  }
}

export class LedgerError extends Error {
  constructor(
    readonly code: 'invalid_amount' | 'same_account',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function sumFor(accountId: string, events: readonly LedgerEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.toAccount === accountId) total += e.amount;
    if (e.fromAccount === accountId) total -= e.amount;
  }
  return total;
}
