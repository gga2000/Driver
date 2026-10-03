import type { Tx } from '@driver/db';
import { KeyedLock } from '../keyed-lock.js';
import type { UnitOfWork } from './unit-of-work.js';

/**
 * Takes `pg_advisory_xact_lock(hashtext(key))` inside `tx`: every other transaction asking for the
 * same key, on any API instance, waits until `tx` commits or rolls back. Returns false (and does
 * nothing) when `tx` is not a database transaction — the in-memory twins (`NoDatabaseRunner`'s marker
 * Tx) and callers without a unit of work; they rely on the in-process `KeyedLock` instead.
 */
export async function advisoryXactLock(tx: Tx | undefined, key: string): Promise<boolean> {
  if (!tx || typeof (tx as { $queryRaw?: unknown }).$queryRaw !== 'function') return false;
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
  return true;
}

/**
 * Per-key mutual exclusion that holds across API instances (backend review 2026-10-04 #22): an
 * in-process `KeyedLock` (one instance's writers, and the in-memory twins, which have no database),
 * then, inside the unit of work's transaction, a Postgres advisory transaction lock on the same key
 * before `fn` runs. Everything `fn` checks and writes in `tx` is serialised against every other
 * holder of the key; the lock is released when the transaction ends.
 *
 * Without a unit of work (unit tests that build a service by hand) only the in-process lock applies.
 * Not re-entrant: never call `run` for a key from inside `fn` of the same key.
 */
export class DistributedKeyedLock {
  private readonly local = new KeyedLock();

  constructor(
    private readonly uow: Pick<UnitOfWork, 'run'> | undefined,
    /** Prefix that namespaces the keys of one use (e.g. `ledger.merchant_cash`). */
    private readonly namespace: string,
  ) {}

  key(id: string): string {
    return `${this.namespace}:${id}`;
  }

  run<T>(id: string, fn: (tx: Tx | undefined) => Promise<T>): Promise<T> {
    const key = this.key(id);
    return this.local.run(key, () =>
      this.uow
        ? this.uow.run(async (tx) => {
            await advisoryXactLock(tx, key);
            return fn(tx);
          })
        : fn(undefined),
    );
  }
}
