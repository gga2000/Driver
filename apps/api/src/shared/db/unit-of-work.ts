import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Tx } from '@driver/db';
import { PrismaService } from './prisma.service.js';

export type { Tx } from '@driver/db';

/**
 * Something that can open an interactive transaction. `PrismaClient` satisfies it; tests
 * pass a stub that hands out a fake `Tx` and records commits and rollbacks.
 */
export interface TransactionRunner {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Unit of work (plan §0.1). `run(fn)` opens one Prisma interactive transaction and gives
 * `fn` the transactional client. A nested `run` inside `fn` reuses the outer `tx`
 * (tracked with AsyncLocalStorage), so a service calling another service's mutating
 * method keeps everything — aggregate rows, events, outbox — in the same transaction.
 *
 * Every mutating service method is shaped as:
 *   return this.uow.run(async (tx) => { await repo.write(tx, …); await events.emit(tx, …); });
 */
@Injectable()
export class UnitOfWork {
  private readonly storage = new AsyncLocalStorage<Tx>();

  private readonly runner: TransactionRunner | (() => TransactionRunner);

  constructor(runner: PrismaService | TransactionRunner) {
    // PrismaService opens the client lazily; resolve it only when a transaction starts.
    this.runner = runner instanceof PrismaService ? () => runner.prisma : runner;
  }

  /** The transaction the caller is already inside, if any. */
  current(): Tx | undefined {
    return this.storage.getStore();
  }

  /** Opens a transaction, or joins the one already open on this async context. */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const outer = this.storage.getStore();
    if (outer) return fn(outer);
    const runner = typeof this.runner === 'function' ? this.runner() : this.runner;
    return runner.$transaction((tx) => this.storage.run(tx, () => fn(tx)));
  }
}
