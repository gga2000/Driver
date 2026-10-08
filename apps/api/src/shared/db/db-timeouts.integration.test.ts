import { afterAll, describe, expect, it } from 'vitest';
import { runAsBackground, runWithRequestId } from '../request-context.js';
import { PrismaService } from './prisma.service.js';
import { UnitOfWork } from './unit-of-work.js';

/**
 * Database time limits on a real Postgres: one role, two lanes. Requests and background work get
 * their own limit on the connection and again inside every transaction (SET LOCAL), and a statement
 * past its limit is cancelled. Needs DATABASE_URL; skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('database time limits per lane (needs DATABASE_URL)', () => {
  const db = new PrismaService(url, { request: 300, background: 3_000 });
  const uow = new UnitOfWork(db);
  const show = async (q: { $queryRawUnsafe: PrismaService['prisma']['$queryRawUnsafe'] }) =>
    (await q.$queryRawUnsafe<Array<{ statement_timeout: string }>>('SHOW statement_timeout'))[0]?.statement_timeout;

  afterAll(() => db.onModuleDestroy());

  it('each lane opens its connections with its own limit', async () => {
    expect(await runWithRequestId('r1', () => db.effectiveTimeoutMs(db.lane()))).toBe(300);
    expect(await runAsBackground('job-1', () => db.effectiveTimeoutMs(db.lane()))).toBe(3_000);
  });

  it('a transaction carries its lane limit even if the connection lost it (pooler)', async () => {
    // One connection per lane, then wipe its limit the way a pooler handing out a fresh server connection would.
    const pool = process.env['DATABASE_POOL_MAX'];
    process.env['DATABASE_POOL_MAX'] = '1';
    const one = new PrismaService(url, { request: 300, background: 3_000 });
    one.client('request'); // clients read the pool size when they open
    one.client('background');
    if (pool === undefined) delete process.env['DATABASE_POOL_MAX'];
    else process.env['DATABASE_POOL_MAX'] = pool;
    const oneUow = new UnitOfWork(one);
    try {
      await one.client('request').$executeRawUnsafe('SET statement_timeout = 0');
      await one.client('background').$executeRawUnsafe('SET statement_timeout = 0');
      expect(await runWithRequestId('r2', () => oneUow.run(async (tx) => show(tx)))).toBe('300ms');
      expect(await runAsBackground('job-2', () => oneUow.run(async (tx) => show(tx)))).toBe('3s');
      // SET LOCAL ends with the transaction: nothing leaks to the next user of the connection.
      expect(await runWithRequestId('r2', () => show(one.client('request')))).toBe('0');
    } finally {
      await one.onModuleDestroy();
    }
  });

  it('cancels a request statement past its limit, while background work may take longer', async () => {
    await expect(runWithRequestId('r3', () => uow.run((tx) => tx.$executeRawUnsafe('SELECT 1 FROM pg_sleep(1)')))).rejects.toThrow(/statement timeout/i);
    await expect(runAsBackground('job-3', () => uow.run((tx) => tx.$queryRawUnsafe('SELECT 1 AS done FROM pg_sleep(1)')))).resolves.toBeDefined();
  });
});
