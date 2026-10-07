import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { PrismaAccessRepository } from './access.repository.js';
import { ACCESS_OPENED_EVENT, AccessService, type AccessSources } from './access.service.js';

/**
 * Customer waves on Postgres: two API instances (each its own unit of work) deciding at once for a
 * zone's last place, and sweeping at once after ops raises the number. The advisory locks are what
 * keep a zone at its number. A city of its own per run keeps the rows apart. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('customer waves on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const clock = new FakeClock('2026-11-14T15:00:00Z');
  const cityId = `wavetest_${randomUUID().slice(0, 8)}`;
  const opened: string[] = [];
  const src: AccessSources = {
    ownZone: async () => ({ cityId, zoneKey: 'hussein' }),
    isStaff: async () => false,
    hasOrdered: async () => false,
    zoneNames: () => new Map([['hussein', 'حي الحسين']]),
    emit: async (_tx, e) => {
      if (e.type === ACCESS_OPENED_EVENT) opened.push(String(e.payload['personId']));
    },
    audit: async () => undefined,
  };
  const instance = () =>
    new AccessService(new PrismaAccessRepository(prisma), src, clock, new UnitOfWork(prisma));
  const a = instance();
  const b = instance();
  const ops = { personId: 'ops', roles: ['dispatcher'], sessionId: 's' } as unknown as Actor;
  const ids = Array.from({ length: 8 }, (_, i) => `${cityId}_p${i}`);
  const count = (state: string) => prisma.prisma.customerAccess.count({ where: { cityId, state } });

  afterAll(async () => {
    await prisma.prisma.customerAccess.deleteMany({ where: { cityId } });
    await prisma.prisma.opsZoneWave.deleteMany({ where: { cityId } });
    await prisma.onModuleDestroy();
  });

  it('eight people deciding at once on two instances fill exactly the open places', async () => {
    await a.setSlots(ops, { cityId, zoneKey: 'hussein', openSlots: 3 });
    const states = await Promise.all(ids.map((id, i) => (i % 2 === 0 ? a : b).decide(id)));
    expect(states.filter((s) => s.state === 'admitted')).toHaveLength(3);
    expect(await count('admitted')).toBe(3);
    expect(await count('waiting')).toBe(5);
  });

  it('two instances sweeping at once after a raise let each person in once, up to the new number', async () => {
    await prisma.prisma.opsZoneWave.update({
      where: { cityId_zoneKey: { cityId, zoneKey: 'hussein' } },
      data: { openSlots: 6 },
    });
    const [x, y] = await Promise.all([
      a.sweepZone(cityId, 'hussein'),
      b.sweepZone(cityId, 'hussein'),
    ]);
    expect(x + y).toBe(3);
    expect(await count('admitted')).toBe(6);
    expect(new Set(opened).size).toBe(opened.length);
    expect(opened).toHaveLength(3);
    // the two still waiting are the two who joined last
    const waiting = await prisma.prisma.customerAccess.findMany({
      where: { cityId, state: 'waiting' },
    });
    expect(waiting).toHaveLength(2);
  });
});
