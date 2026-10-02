import { describe, expect, it } from 'vitest';
import type { Tx } from '@driver/db';
import { UnitOfWork, type TransactionRunner } from './unit-of-work.js';

/** Fake runner: hands out a numbered fake Tx and records whether each one committed. */
function fakeRunner() {
  const log: string[] = [];
  let n = 0;
  const runner: TransactionRunner = {
    async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      n += 1;
      const id = n;
      log.push(`begin ${id}`);
      try {
        const out = await fn({ txId: id } as unknown as Tx);
        log.push(`commit ${id}`);
        return out;
      } catch (err) {
        log.push(`rollback ${id}`);
        throw err;
      }
    },
  };
  return { runner, log };
}

const txId = (tx: Tx) => (tx as unknown as { txId: number }).txId;

describe('UnitOfWork', () => {
  it('opens one transaction and commits it', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    const out = await uow.run(async (tx) => txId(tx));
    expect(out).toBe(1);
    expect(log).toEqual(['begin 1', 'commit 1']);
  });

  it('nested runs reuse the outer transaction', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    const ids = await uow.run(async (outer) => {
      const inner = await uow.run(async (tx) => txId(tx));
      const deeper = await uow.run(async () => uow.run(async (tx) => txId(tx)));
      expect(uow.current()).toBe(outer);
      return [txId(outer), inner, deeper];
    });
    expect(ids).toEqual([1, 1, 1]);
    expect(log).toEqual(['begin 1', 'commit 1']);
  });

  it('rolls back everything when a nested run throws', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    await expect(
      uow.run(async () => {
        await uow.run(async () => {
          throw new Error('boom');
        });
      }),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['begin 1', 'rollback 1']);
    expect(uow.current()).toBeUndefined();
  });

  it('sibling runs outside any transaction each get their own', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    const [a, b] = await Promise.all([uow.run(async (tx) => txId(tx)), uow.run(async (tx) => txId(tx))]);
    expect(new Set([a, b]).size).toBe(2);
    expect(log.filter((l) => l.startsWith('commit'))).toHaveLength(2);
  });

  it('context does not leak between concurrent async chains', async () => {
    const { runner } = fakeRunner();
    const uow = new UnitOfWork(runner);
    const seen: number[] = [];
    await Promise.all([
      uow.run(async (tx) => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(txId(uow.current()!) === txId(tx) ? 1 : -1);
      }),
      uow.run(async (tx) => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(txId(uow.current()!) === txId(tx) ? 1 : -1);
      }),
    ]);
    expect(seen).toEqual([1, 1]);
  });
});
