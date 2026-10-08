import { Injectable } from '@nestjs/common';
import type { Tx } from '@driver/db';
import { advisoryXactLock } from '../../shared/db/advisory-lock.js';

/**
 * SEC-07: one customer wallet, several modules spending it. The ledger only debits a wallet when the
 * thing it pays for settles (a food order at close, a seat at completion, a request deposit when it
 * settles), so until then each module keeps its own holds against the same balance: open wallet
 * orders (orders), prepaid seats and matched request deposits (routes). Every spend path asks what the
 * others hold through this registry, so one balance can never pay for two things at once.
 *
 * The check runs under {@link lockWallets} in the spending transaction, so two spends of one wallet
 * on any API instance are serialised: the second sees the first's hold.
 */
export type WalletHoldSource = (customerId: string, tx: Tx | undefined) => Promise<number>;

@Injectable()
export class WalletHolds {
  private readonly sources = new Map<string, WalletHoldSource>();

  /** A module's holds against customers' own wallets (`customer:<id>`). Returns the unregister. */
  register(name: string, source: WalletHoldSource): () => void {
    this.sources.set(name, source);
    return () => {
      if (this.sources.get(name) === source) this.sources.delete(name);
    };
  }

  /** What every other module holds against the customer's wallet (the caller counts its own). */
  async heldExcept(name: string, customerId: string, tx?: Tx): Promise<number> {
    let held = 0;
    for (const [source, fn] of this.sources) if (source !== name) held += await fn(customerId, tx);
    return held;
  }

  /** What every module holds against the customer's wallet. */
  async held(customerId: string, tx?: Tx): Promise<number> {
    return this.heldExcept('', customerId, tx);
  }
}

export const walletLockKey = (customerId: string): string => `wallet:${customerId}`;

/**
 * The wallet locks of every customer a transaction may charge, taken first in the transaction and in
 * id order (the lock-order rule: wallet locks, then the routes lock, then household / request-key
 * locks), so two spenders can never wait on each other's wallets. Postgres advisory locks are
 * re-entrant within a transaction, so taking a key twice is harmless. No-op outside a database
 * transaction (the in-memory twins).
 */
export async function lockWallets(tx: Tx | undefined, customerIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(customerIds)].sort()) await advisoryXactLock(tx, walletLockKey(id));
}
