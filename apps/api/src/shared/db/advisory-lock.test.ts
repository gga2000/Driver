import { describe, expect, it } from 'vitest';
import type { Tx } from '@driver/db';
import { advisoryXactLock, DistributedKeyedLock } from './advisory-lock.js';
import { NoDatabaseRunner, UnitOfWork } from './unit-of-work.js';

/** A database-like transaction that records every raw query (sql with ? for values, then the values). */
function recordingTx(): { tx: Tx; queries: Array<{ sql: string; values: unknown[] }> } {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values });
      return [{ ok: 1 }];
    },
  } as unknown as Tx;
  return { tx, queries };
}

describe('advisory locks (backend review 2026-10-04 #22)', () => {
  it('takes pg_advisory_xact_lock(hashtext(key)) inside a database transaction, nothing on the in-memory marker', async () => {
    const { tx, queries } = recordingTx();
    expect(await advisoryXactLock(tx, 'ops.cash:k1')).toBe(true);
    expect(queries).toEqual([{ sql: expect.stringContaining('pg_advisory_xact_lock(hashtext(?))'), values: ['ops.cash:k1'] }]);
    await new NoDatabaseRunner().$transaction(async (marker) => expect(await advisoryXactLock(marker, 'x')).toBe(false));
    expect(await advisoryXactLock(undefined, 'x')).toBe(false);
  });

  it('DistributedKeyedLock: the advisory lock first in the unit of work, and one holder per key in process', async () => {
    const { tx, queries } = recordingTx();
    const uow = new UnitOfWork({ $transaction: (fn) => fn(tx) });
    const lock = new DistributedKeyedLock(uow, 'ledger.merchant_cash');
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = lock.run('m1', async (t) => {
      expect(t).toBe(tx);
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    const second = lock.run('m1', async () => {
      order.push('second');
    });
    const other = lock.run('m2', async () => {
      order.push('other');
    });
    await other;
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'other', 'first:end', 'second']);
    expect(queries.map((q) => q.values[0])).toEqual(['ledger.merchant_cash:m1', 'ledger.merchant_cash:m2', 'ledger.merchant_cash:m1']);
  });
});
