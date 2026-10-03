import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
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
 * Runner used when no DATABASE_URL is configured: there is nothing to begin or commit, so `fn`
 * simply runs with a marker Tx. In-memory repositories ignore the Tx; Prisma ones are never
 * bound in this mode.
 */
export class NoDatabaseRunner implements TransactionRunner {
  private seq = 0;

  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.seq += 1;
    return fn({ noDatabase: true, txId: this.seq } as unknown as Tx);
  }
}

export type TxHook = () => void | Promise<void>;

interface TxHooks {
  commit: TxHook[];
  rollback: TxHook[];
}

/**
 * Lifecycle hooks per open top-level transaction. Module-level (not per UnitOfWork instance) so a
 * repository or service handed a `tx` by any unit of work can tell whether it is managed.
 */
const lifecycle = new WeakMap<object, TxHooks>();
const logger = new Logger('UnitOfWork');

/**
 * Runs `fn` after `tx` commits (in registration order, awaited by the `run` that opened it).
 * Returns false when `tx` is not an open transaction of any UnitOfWork (undefined, a fake `Tx`
 * built by hand, or already finished); the caller then decides what "after commit" means.
 */
export function afterCommit(tx: Tx | undefined, fn: TxHook): boolean {
  const hooks = tx ? lifecycle.get(tx as object) : undefined;
  if (!hooks) return false;
  hooks.commit.push(fn);
  return true;
}

/** Runs `fn` if `tx` rolls back. Same return contract as `afterCommit`. */
export function onRollback(tx: Tx | undefined, fn: TxHook): boolean {
  const hooks = tx ? lifecycle.get(tx as object) : undefined;
  if (!hooks) return false;
  hooks.rollback.push(fn);
  return true;
}

async function runHooks(hooks: TxHook[], phase: 'commit' | 'rollback'): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (err) {
      // The transaction has already finished; throwing would make the caller retry committed work.
      logger.error(`after-${phase} hook failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }
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
    if (runner instanceof PrismaService) {
      const fallback = new NoDatabaseRunner();
      this.runner = () => (runner.configured ? runner.prisma : fallback);
    } else {
      this.runner = runner;
    }
  }

  /** The transaction the caller is already inside, if any. */
  current(): Tx | undefined {
    return this.storage.getStore();
  }

  /**
   * Opens a transaction, or joins the one already open on this async context. After a top-level
   * transaction commits, its `afterCommit` hooks run (awaited) before `run` resolves; after a
   * rollback its `onRollback` hooks run and the error is rethrown.
   */
  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const outer = this.storage.getStore();
    if (outer) return fn(outer);
    const runner = typeof this.runner === 'function' ? this.runner() : this.runner;
    let hooks: TxHooks | undefined;
    let opened: object | undefined;
    let out: T;
    try {
      out = await runner.$transaction((tx) => {
        hooks = { commit: [], rollback: [] };
        opened = tx as object;
        lifecycle.set(opened, hooks);
        return this.storage.run(tx, () => fn(tx));
      });
    } catch (err) {
      if (opened) lifecycle.delete(opened);
      if (hooks) await runHooks(hooks.rollback, 'rollback');
      throw err;
    }
    if (opened) lifecycle.delete(opened);
    if (hooks) await runHooks(hooks.commit, 'commit');
    return out;
  }

  /** See the module-level `afterCommit`. */
  afterCommit(tx: Tx | undefined, fn: TxHook): boolean {
    return afterCommit(tx, fn);
  }

  /** See the module-level `onRollback`. */
  onRollback(tx: Tx | undefined, fn: TxHook): boolean {
    return onRollback(tx, fn);
  }
}
