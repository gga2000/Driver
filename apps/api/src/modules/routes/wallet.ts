import type { LedgerEvent } from '@driver/contracts';
import type { Tx } from '@driver/db';
import { Accounts, type LedgerService, type WalletHolds } from '../ledger/index.js';
import type { RoutesPointsReader } from './tokens.js';

/**
 * The rider's wallet as the routes module needs it: the balance the ledger owes the customer
 * (`customer:<id>`, positive = credit). Prepaid seats and request-board deposits are holds the
 * routes module keeps against that balance until the seat completes (`seat.completed` debits it) or
 * the deposit settles; the ledger has no hold primitive of its own.
 */
export interface WalletPort {
  balance(customerId: string): Promise<number>;
  /** SEC-07: what the rest of the platform holds against the same wallet (open wallet orders). */
  heldElsewhere(customerId: string, tx?: Tx): Promise<number>;
}

export const ROUTES_WALLET = Symbol('ROUTES_WALLET');

export class LedgerWallet implements WalletPort {
  constructor(
    private readonly ledger: Pick<LedgerService, 'balance'>,
    private readonly holds?: Pick<WalletHolds, 'heldExcept'>,
  ) {}

  async balance(customerId: string): Promise<number> {
    return (await this.ledger.balance(Accounts.customer(customerId))).amount;
  }

  async heldElsewhere(customerId: string, tx?: Tx): Promise<number> {
    return this.holds ? this.holds.heldExcept(ROUTES_WALLET_HOLDS, customerId, tx) : 0;
  }
}

/** The routes module's name in the wallet-holds registry (prepaid seats and request deposits). */
export const ROUTES_WALLET_HOLDS = 'routes';

/** Test double: balances set by hand. */
export class FakeWallet implements WalletPort {
  readonly balances = new Map<string, number>();
  readonly elsewhere = new Map<string, number>();

  set(customerId: string, amount: number): this {
    this.balances.set(customerId, amount);
    return this;
  }

  async balance(customerId: string): Promise<number> {
    return this.balances.get(customerId) ?? 0;
  }

  async heldElsewhere(customerId: string): Promise<number> {
    return this.elsewhere.get(customerId) ?? 0;
  }
}

/**
 * Points one booking's seats earned (joy r2): the points the ledger posted to the rider under the
 * booking's seat groups (`seat:<bookingId>.<seat>:points`). Null when none are posted (yet).
 */
export function bookingPoints(events: readonly Pick<LedgerEvent, 'kind' | 'toAccount' | 'postingGroupId' | 'amount'>[], riderId: string, bookingId: string): number | null {
  const account = Accounts.points(riderId);
  const prefix = `seat:${bookingId}.`;
  const mine = events.filter((e) => e.kind === 'points' && e.toAccount === account && (e.postingGroupId ?? '').startsWith(prefix) && (e.postingGroupId ?? '').endsWith(':points'));
  return mine.length > 0 ? mine.reduce((s, e) => s + e.amount, 0) : null;
}

export class LedgerPoints implements RoutesPointsReader {
  constructor(private readonly ledger: Pick<LedgerService, 'eventsFor'>) {}

  async pointsForBooking(riderId: string, bookingId: string): Promise<number | null> {
    return bookingPoints(await this.ledger.eventsFor(Accounts.points(riderId)), riderId, bookingId);
  }
}
