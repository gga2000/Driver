import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { lockWallets } from '../ledger/index.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';

export interface RoutesWriteOptions {
  /**
   * SEC-07: the customers whose wallet this write may spend. Their wallet locks are taken first, in id
   * order, before the routes lock (the lock-order rule), so a seat or deposit can never race a food
   * order or a tip on the same wallet. A nested write joins the outer transaction, which already holds
   * the routes lock, so its customers must be among the outer write's.
   */
  walletLocks?: readonly string[];
}

/**
 * One writer for the whole intercity system: every mutation (a hold, a walk-up, a move between two
 * departures, a tick) runs under a single in-process mutex and, with Postgres, a transaction-scoped
 * advisory lock — so two riders can never hold the same seat and a move never races a hold on the
 * target car. The garages see a few writes a second at most; one lock is plenty and cannot deadlock.
 * Re-entrant: a write started inside another (a driver's announcement converting demand posts into
 * holds) joins the outer transaction.
 *
 * Services check everything before they write anything, so a refused request leaves no partial
 * state behind even on the in-memory repository (which cannot roll back).
 */
@Injectable()
export class RoutesWriter {
  private readonly logger = new Logger(RoutesWriter.name);
  private tail: Promise<unknown> = Promise.resolve();
  private readonly inside = new AsyncLocalStorage<{ tx: Tx; wallets: ReadonlySet<string> }>();

  constructor(
    private readonly uow: UnitOfWork,
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
  ) {}

  run<T>(fn: (tx: Tx) => Promise<T>, opts?: RoutesWriteOptions): Promise<T> {
    const wallets = opts?.walletLocks ?? [];
    const current = this.inside.getStore();
    if (current !== undefined) {
      const missing = wallets.filter((id) => !current.wallets.has(id));
      if (missing.length > 0) {
        // Taking them now would come after the routes lock: a deadlock waiting to happen.
        const message = `nested routes write spends undeclared wallets (${missing.join(', ')}): declare them on the outer write`;
        if (process.env['NODE_ENV'] === 'test') throw new Error(message);
        this.logger.error(message);
      }
      return fn(current.tx);
    }
    const next = this.tail.then(() =>
      this.uow.run(async (tx) => {
        await lockWallets(tx, wallets);
        await this.repo.lock(tx);
        return this.inside.run({ tx, wallets: new Set(wallets) }, () => fn(tx));
      }),
    );
    this.tail = next.catch(() => undefined);
    return next;
  }
}
