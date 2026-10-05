import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaZonesRepository } from './zones.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = 'zt_zone_city';

describe.skipIf(!url)('zones on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaZonesRepository(prisma);

  beforeAll(async () => {
    await prisma.prisma.$executeRaw`INSERT INTO "public"."cities" ("id", "name_ar", "name_en", "updated_at") VALUES (${CITY}, 'تجربة', 'Test', now()) ON CONFLICT ("id") DO NOTHING`;
    await prisma.prisma.$executeRaw`
      INSERT INTO "public"."zones" ("id", "city_id", "key", "name_ar", "name_en", "tier", "polygon", "updated_at")
      VALUES ('zt_zone_1', ${CITY}, 'centre', 'مركز', 'Centre', 'centre'::"public"."ZoneTier",
              ST_GeogFromText('POLYGON((45.05 32.90, 45.07 32.90, 45.06 32.91, 45.05 32.90))'), now())
      ON CONFLICT ("city_id", "key") DO NOTHING`;
  });
  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."zones" WHERE "city_id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."cities" WHERE "id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  it('reads the draft and writes a placement', async () => {
    expect((await repo.list(CITY))[0]).toMatchObject({ key: 'centre', placement: 'draft', centre: null });
    const ring = [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.08 }, { lat: 32.92, lng: 45.065 }];
    const saved = await repo.savePlacement({ cityId: CITY, key: 'centre', ring, centre: { lat: 32.907, lng: 45.065 }, placedById: 'p_ali', placedAt: new Date('2026-10-05T10:00:00Z') });
    expect(saved).toMatchObject({ placement: 'placed', placedById: 'p_ali', centre: { lat: 32.907, lng: 45.065 } });
    expect(saved!.ring).toHaveLength(3);
    expect(await repo.savePlacement({ cityId: CITY, key: 'nope', ring, centre: { lat: 32.907, lng: 45.065 }, placedById: 'p_ali', placedAt: new Date() })).toBeNull();
  });
});
