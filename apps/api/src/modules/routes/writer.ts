import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';

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
  private tail: Promise<unknown> = Promise.resolve();
  private readonly inside = new AsyncLocalStorage<Tx>();

  constructor(
    private readonly uow: UnitOfWork,
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
  ) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const current = this.inside.getStore();
    if (current !== undefined) return fn(current);
    const next = this.tail.then(() =>
      this.uow.run(async (tx) => {
        await this.repo.lock(tx);
        return this.inside.run(tx, () => fn(tx));
      }),
    );
    this.tail = next.catch(() => undefined);
    return next;
  }
}
