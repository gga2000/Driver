import { Accounts, type LedgerService } from '../ledger/index.js';

/**
 * The rider's wallet as the routes module needs it: the balance the ledger owes the customer
 * (`customer:<id>`, positive = credit). Prepaid seats and request-board deposits are holds the
 * routes module keeps against that balance until the seat completes (`seat.completed` debits it) or
 * the deposit settles; the ledger has no hold primitive of its own.
 */
export interface WalletPort {
  balance(customerId: string): Promise<number>;
}

export const ROUTES_WALLET = Symbol('ROUTES_WALLET');

export class LedgerWallet implements WalletPort {
  constructor(private readonly ledger: Pick<LedgerService, 'balance'>) {}

  async balance(customerId: string): Promise<number> {
    return (await this.ledger.balance(Accounts.customer(customerId))).amount;
  }
}

/** Test double: balances set by hand. */
export class FakeWallet implements WalletPort {
  readonly balances = new Map<string, number>();

  set(customerId: string, amount: number): this {
    this.balances.set(customerId, amount);
    return this;
  }

  async balance(customerId: string): Promise<number> {
    return this.balances.get(customerId) ?? 0;
  }
}
