import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaClosuresRepository } from './closures.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = 'zt_closures_city';

describe.skipIf(!url)('street closures on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaClosuresRepository(prisma);
  const NOW = new Date('2026-10-12T09:00:00Z');
  const MIDNIGHT = new Date('2026-10-12T21:00:00Z');
  const path = [{ lat: 32.905, lng: 45.06 }, { lat: 32.9068, lng: 45.06 }];
  const mine = (ids: readonly string[]) => (rows: Array<{ id: string }>) => rows.filter((r) => ids.includes(r.id)).map((r) => r.id).sort();

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."street_closures" WHERE "city_id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  it('an ops closure is live at once; a courier report waits, then lives once confirmed', async () => {
    const ops = await repo.create({ cityId: CITY, path, reason: 'works', nameAr: 'شارع المستشفى', lengthM: 200, startsAt: NOW, endsAt: MIDNIGHT, closedById: 'p_ops', source: 'ops' });
    expect(ops).toMatchObject({ cityId: CITY, path, reason: 'works', nameAr: 'شارع المستشفى', source: 'ops', openedAt: null, confirmedAt: null });
    const report = await repo.create({ cityId: CITY, path, reason: 'water', nameAr: null, lengthM: 150, startsAt: NOW, endsAt: new Date(NOW.getTime() + 2 * 3_600_000), closedById: 'p_haider', source: 'courier' });
    const ids = [ops.id, report.id];
    expect(mine(ids)(await repo.live(NOW))).toEqual([ops.id]);
    expect((await repo.waiting(CITY, NOW)).map((r) => r.id)).toEqual([report.id]);
    expect((await repo.reportsBy('p_haider', new Date('2026-10-11T21:00:00Z'))).map((r) => r.id)).toEqual([report.id]);
    // An unconfirmed report past its 2 hours waits no longer.
    expect(await repo.waiting(CITY, new Date(NOW.getTime() + 2 * 3_600_000 + 1))).toEqual([]);

    const at = new Date(NOW.getTime() + 600_000);
    const confirmed = await repo.confirm(report.id, 'p_ops', at, MIDNIGHT);
    expect(confirmed).toMatchObject({ confirmedAt: at, confirmedById: 'p_ops', endsAt: MIDNIGHT });
    // A second confirm keeps the first.
    expect(await repo.confirm(report.id, 'p_ali', new Date(at.getTime() + 60_000), new Date(at.getTime() + 120_000))).toMatchObject({ confirmedById: 'p_ops', endsAt: MIDNIGHT });
    expect(mine(ids)(await repo.live(at))).toEqual([...ids].sort());
    expect(await repo.waiting(CITY, at)).toEqual([]);
  });

  it('opening early keeps the first opening and drops it from the live list; the day list still has it', async () => {
    const row = await repo.create({ cityId: CITY, path, reason: 'funeral', nameAr: null, lengthM: 200, startsAt: NOW, endsAt: MIDNIGHT, closedById: 'p_ops', source: 'ops' });
    const at = new Date(NOW.getTime() + 3_600_000);
    expect(await repo.open(row.id, 'p_ops', at)).toMatchObject({ openedAt: at, openedById: 'p_ops' });
    expect(await repo.open(row.id, 'p_ali', new Date(at.getTime() + 60_000))).toMatchObject({ openedAt: at, openedById: 'p_ops' });
    expect((await repo.live(at)).some((r) => r.id === row.id)).toBe(false);
    expect((await repo.endingAfter(CITY, new Date('2026-10-11T21:00:00Z'))).some((r) => r.id === row.id)).toBe(true);
    expect(await repo.get(row.id)).toMatchObject({ id: row.id, path });
    expect(await repo.get('cls_missing')).toBeNull();
  });

  it('the table refuses an unknown reason or source and an end before the start', async () => {
    const base = { cityId: CITY, path, reason: 'works' as const, nameAr: null, lengthM: 100, startsAt: NOW, endsAt: MIDNIGHT, closedById: 'p_ops', source: 'ops' as const };
    await expect(repo.create({ ...base, reason: 'party' as never })).rejects.toThrow();
    await expect(repo.create({ ...base, source: 'customer' as never })).rejects.toThrow();
    await expect(repo.create({ ...base, endsAt: NOW })).rejects.toThrow();
  });
});
