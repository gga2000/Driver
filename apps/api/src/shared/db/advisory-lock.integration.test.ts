import { afterAll, describe, expect, it } from 'vitest';
import { DistributedKeyedLock } from './advisory-lock.js';
import { PrismaService } from './prisma.service.js';
import { UnitOfWork } from './unit-of-work.js';

/**
 * `pg_advisory_xact_lock` across two "API instances" (two lock objects, so the in-process lock does
 * not help): the second holder of a key waits for the first transaction to commit (review #22).
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('advisory transaction locks on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('serialises one key across instances and lets other keys run', async () => {
    const [podA, podB] = [new DistributedKeyedLock(new UnitOfWork(prisma), 'test.lock'), new DistributedKeyedLock(new UnitOfWork(prisma), 'test.lock')];
    const key = `k-${Date.now()}`;
    const log: string[] = [];
    const a = podA.run(key, async () => {
      log.push('a:start');
      await new Promise((r) => setTimeout(r, 300));
      log.push('a:end');
    });
    // Until a holds the key: its first transaction may still be opening a connection (cold pool).
    while (!log.includes('a:start')) await new Promise((r) => setTimeout(r, 5));
    const b = podB.run(key, async () => {
      log.push('b');
    });
    const other = podB.run(`${key}-other`, async () => {
      log.push('other');
    });
    await Promise.all([a, b, other]);
    expect(log.indexOf('b')).toBeGreaterThan(log.indexOf('a:end'));
    expect(log.indexOf('other')).toBeLessThan(log.indexOf('a:end'));
  });
});
