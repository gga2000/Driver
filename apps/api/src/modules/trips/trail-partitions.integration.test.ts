import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaTripsRepository } from './trips.repository.js';

const url = process.env['DATABASE_URL'];
const DRIVER = 'zt_trail_days_driver';
const CITY = 'zt_trail_days_city';
const KEPT = 'zt_trail_days_kept_trip';
/** Days long past (before any real point), so the test never touches partitions the API made for real points. */
const DAY1 = new Date('2001-03-01T00:00:00Z');
const at = (iso: string) => new Date(iso);

/** Daily trail partitions (speed audit z1/z2) on real Postgres: made ahead, expired days dropped whole. */
describe.skipIf(!url)('daily trail partitions on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaTripsRepository(prisma);
  const parts = async () =>
    (
      await prisma.prisma.$queryRaw<Array<{ name: string; rls: boolean }>>`
        SELECT c."relname" AS "name", c."relrowsecurity" AS "rls" FROM "pg_inherits" i
        JOIN "pg_class" c ON c."oid" = i."inhrelid" JOIN "pg_class" p ON p."oid" = i."inhparent"
        WHERE p."relname" = 'trail_points' AND c."relname" LIKE 'trail_points_2001_03_%' ORDER BY 1`
    );
  const point = (iso: string, tripId: string | null) =>
    repo.addTrailPoint({ tripId, driverId: DRIVER, at: at(iso), pin: { lat: 32.905, lng: 45.06 }, speedKmh: null, bearing: null, accuracyM: 10 });

  beforeAll(async () => {
    await prisma.prisma.$executeRaw`INSERT INTO "public"."people" ("id", "updated_at") VALUES (${DRIVER}, now()) ON CONFLICT ("id") DO NOTHING`;
    await prisma.prisma.$executeRaw`INSERT INTO "public"."cities" ("id", "name_ar", "name_en", "updated_at") VALUES (${CITY}, 'اختبار', 'Test', now()) ON CONFLICT ("id") DO NOTHING`;
    await prisma.prisma.$executeRaw`INSERT INTO "public"."trips" ("id", "city_id", "vertical", "updated_at") VALUES (${KEPT}, ${CITY}, 'taxi', now()) ON CONFLICT ("id") DO NOTHING`;
  });
  afterAll(async () => {
    for (const p of await parts()) await prisma.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "public"."${p.name}"`);
    await prisma.prisma.$executeRaw`DELETE FROM "public"."trail_points" WHERE "driver_id" = ${DRIVER}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."trips" WHERE "id" = ${KEPT}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."cities" WHERE "id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."people" WHERE "id" = ${DRIVER}`;
    await prisma.onModuleDestroy();
  });

  it('makes one partition per day ahead, each with row security on, and making them again changes nothing', async () => {
    await repo.ensureTrailPartitions(DAY1, 2);
    await repo.ensureTrailPartitions(DAY1, 2);
    expect(await parts()).toEqual([
      { name: 'trail_points_2001_03_01', rls: true },
      { name: 'trail_points_2001_03_02', rls: true },
      { name: 'trail_points_2001_03_03', rls: true },
    ]);
  });

  it('drops each whole expired day, but not one a kept trail is in, nor a day not yet over', async () => {
    await point('2001-03-01T10:00:00Z', null);
    await point('2001-03-02T10:00:00Z', KEPT);
    await point('2001-03-02T11:00:00Z', null);
    await point('2001-03-03T10:00:00Z', null);
    const first = await repo.dropExpiredTrailPartitions(at('2001-03-03T06:00:00Z'), [KEPT]);
    expect(first).toEqual({ dropped: ['trail_points_2001_03_01'], failed: [] });
    expect((await parts()).map((p) => p.name)).toEqual(['trail_points_2001_03_02', 'trail_points_2001_03_03']);
    // Once the incident is closed, its day goes too.
    expect(await repo.dropExpiredTrailPartitions(at('2001-03-03T06:00:00Z'), [])).toEqual({ dropped: ['trail_points_2001_03_02'], failed: [] });
    const left = await prisma.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "public"."trail_points" WHERE "driver_id" = ${DRIVER}`;
    expect(left[0]!.n).toBe(1n);
  });

  it('a partition someone else holds is left for the next run; the others still go', async () => {
    await repo.ensureTrailPartitions(at('2001-03-04T00:00:00Z'), 1);
    const other = new PrismaService(url);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = other.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "public"."trail_points_2001_03_04" IN ACCESS SHARE MODE`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    const out = await repo.dropExpiredTrailPartitions(at('2001-03-06T00:00:00Z'), []);
    release();
    await holder;
    await other.onModuleDestroy();
    expect(out.dropped).toEqual(['trail_points_2001_03_03', 'trail_points_2001_03_05']);
    expect(out.failed.map((f) => f.name)).toEqual(['trail_points_2001_03_04']);
    expect((await parts()).map((p) => p.name)).toEqual(['trail_points_2001_03_04']);
  }, 30_000);
});
