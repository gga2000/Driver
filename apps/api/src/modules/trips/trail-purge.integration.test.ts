import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaTripsRepository } from './trips.repository.js';

const url = process.env['DATABASE_URL'];
const DRIVER = 'zt_trail_purge_driver';
const DAY_MS = 86_400_000;

/** The 30-day trail purge (decision D6) on real Postgres: partitioned table, batched DELETE, kept trips. */
describe.skipIf(!url)('trail purge on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaTripsRepository(prisma);
  const now = new Date();

  beforeAll(async () => {
    await prisma.prisma.$executeRaw`INSERT INTO "public"."people" ("id", "updated_at") VALUES (${DRIVER}, now()) ON CONFLICT ("id") DO NOTHING`;
    for (const daysAgo of [45, 40, 35, 1]) {
      await repo.addTrailPoint({ tripId: null, driverId: DRIVER, at: new Date(now.getTime() - daysAgo * DAY_MS), pin: { lat: 32.905, lng: 45.06 }, speedKmh: null, bearing: null, accuracyM: 10 });
    }
  });
  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."trail_points" WHERE "driver_id" = ${DRIVER}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."people" WHERE "id" = ${DRIVER}`;
    await prisma.onModuleDestroy();
  });

  it('deletes points older than the cutoff in batches and keeps newer ones', async () => {
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    const mine = async () => (await prisma.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "public"."trail_points" WHERE "driver_id" = ${DRIVER}`)[0]!.n;
    expect(await mine()).toBe(4n);
    let deleted = 0;
    for (;;) {
      const n = await repo.purgeTrail(cutoff, ['zt_some_kept_trip'], 2);
      deleted += n;
      if (n < 2) break;
    }
    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(await mine()).toBe(1n);
    expect((await repo.lastTrailPoint({ driverId: DRIVER }))?.at.getTime()).toBeGreaterThan(cutoff.getTime());
  });
});
