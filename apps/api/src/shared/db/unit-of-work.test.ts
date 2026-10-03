import { describe, expect, it } from 'vitest';
import type { Tx } from '@driver/db';
import { NoDatabaseRunner, UnitOfWork, afterCommit, onRollback, type TransactionRunner } from './unit-of-work.js';

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

  it('after-commit hooks run once the outermost transaction commits, before run() resolves', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    await uow.run(async (tx) => {
      expect(uow.afterCommit(tx, () => void log.push('hook a'))).toBe(true);
      await uow.run(async (inner) => {
        afterCommit(inner, async () => {
          log.push('hook b');
        });
      });
      log.push('body done');
    });
    expect(log).toEqual(['begin 1', 'body done', 'commit 1', 'hook a', 'hook b']);
  });

  it('rollback runs rollback hooks and skips commit hooks', async () => {
    const { runner, log } = fakeRunner();
    const uow = new UnitOfWork(runner);
    await expect(
      uow.run(async (tx) => {
        afterCommit(tx, () => void log.push('commit hook'));
        onRollback(tx, () => void log.push('rollback hook'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(log).toEqual(['begin 1', 'rollback 1', 'rollback hook']);
  });

  it('hooks cannot be registered on an unmanaged or finished tx', async () => {
    const uow = new UnitOfWork(new NoDatabaseRunner());
    expect(afterCommit(undefined, () => undefined)).toBe(false);
    expect(afterCommit({ fake: true } as unknown as Tx, () => undefined)).toBe(false);
    let finished: Tx | undefined;
    await uow.run(async (tx) => {
      finished = tx;
    });
    expect(onRollback(finished, () => undefined)).toBe(false);
  });

  it('a failing hook is logged, not thrown: the work already committed', async () => {
    const uow = new UnitOfWork(new NoDatabaseRunner());
    const ran: string[] = [];
    const out = await uow.run(async (tx) => {
      afterCommit(tx, () => {
        throw new Error('hook failed');
      });
      afterCommit(tx, () => void ran.push('second'));
      return 7;
    });
    expect(out).toBe(7);
    expect(ran).toEqual(['second']);
  });
});
