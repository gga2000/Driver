/**
 * `pnpm db:seed` — idempotent seed for a local Driver database (plan Step 1).
 *
 * Writes: 3 cities, the 34 Aziziyah zones with draft hexagon polygons (tier + extId), 4 garages and
 * 6 street-pickup meeting points (plus the الرجعة drafts: a Kut garage and 3 on-the-way points),
 * taxonomy roots, a demo restaurant org with a 10-item catalog
 * (modifier groups included), and a dispatcher person whose phone lives only in the vault.
 * Re-running updates in place; nothing is duplicated.
 */
import { createHmac } from 'node:crypto';
import { createPrisma, type PrismaClient, type Tx } from '../src/index.js';
import {
  AZIZIYAH_ZONES,
  CITIES,
  DEMO_RESTAURANT,
  DISPATCHER,
  INTERCITY_DRAFT_POINTS,
  MEETING_POINTS,
  TAXONOMY,
  hexagonWkt,
  pointWkt,
} from './seed-data.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set — copy .env.example to .env and run `pnpm db:up` first.');
  process.exit(1);
}

/** Same peppered HMAC as apps/api modules/identity/phone.ts, so the seeded dispatcher can log in. */
function phoneHash(phoneE164: string): string {
  const pepper = process.env['PHONE_HASH_PEPPER'] ?? process.env['JWT_SECRET'] ?? 'dev-only-pepper';
  return createHmac('sha256', pepper).update(phoneE164).digest('hex');
}

const now = () => new Date();

async function seedCities(tx: Tx): Promise<void> {
  for (const c of CITIES) {
    await tx.city.upsert({
      where: { id: c.id },
      update: { nameAr: c.nameAr, nameEn: c.nameEn, active: c.active },
      create: { id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, active: c.active, timezone: 'Asia/Baghdad', roundingStep: 250 },
    });
  }
}

/** Zones carry a PostGIS polygon Prisma cannot write through the ORM, so the row goes in with raw SQL. */
async function seedZones(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const z of AZIZIYAH_ZONES) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "public"."zones" ("id", "city_id", "key", "name_ar", "name_en", "tier", "ext_id", "polygon", "tuktuk_opt_in", "updated_at")
      VALUES (
        ${'zone_' + z.id}, 'aziziyah', ${z.id}, ${z.name_ar}, ${z.name_en}, ${z.tier}::"public"."ZoneTier", ${z.extId},
        ST_GeogFromText(${hexagonWkt(z)}), ${z.tier !== 'edge'}, ${now()}
      )
      ON CONFLICT ("city_id", "key") DO UPDATE SET
        "name_ar" = EXCLUDED."name_ar", "name_en" = EXCLUDED."name_en", "tier" = EXCLUDED."tier",
        "ext_id" = EXCLUDED."ext_id", "updated_at" = EXCLUDED."updated_at",
        -- never overwrite a polygon drivers have verified
        "polygon" = CASE WHEN "zones"."verified_at" IS NULL THEN EXCLUDED."polygon" ELSE "zones"."polygon" END
      RETURNING "id"`;
    ids.set(z.id, rows[0]!.id);
  }
  return ids;
}

async function seedMeetingPoints(tx: Tx, zoneIds: Map<string, string>): Promise<void> {
  for (const m of [...MEETING_POINTS, ...INTERCITY_DRAFT_POINTS]) {
    const zoneId = m.zoneKey ? (zoneIds.get(m.zoneKey) ?? null) : null;
    await tx.$executeRaw`
      INSERT INTO "public"."meeting_points" ("id", "city_id", "zone_id", "name_ar", "name_en", "pin", "reachable_by", "garage", "geofence_m", "updated_at")
      VALUES (
        ${'mp_' + m.key}, ${m.cityId}, ${zoneId}, ${m.nameAr}, ${m.nameEn}, ST_GeogFromText(${pointWkt(m)}),
        ${m.reachableBy}::"public"."VehicleClass"[], ${m.garage}, ${m.garage ? 150 : 60}, ${now()}
      )
      ON CONFLICT ("id") DO UPDATE SET
        "zone_id" = EXCLUDED."zone_id", "name_ar" = EXCLUDED."name_ar", "name_en" = EXCLUDED."name_en",
        "pin" = EXCLUDED."pin", "reachable_by" = EXCLUDED."reachable_by", "garage" = EXCLUDED."garage",
        "geofence_m" = EXCLUDED."geofence_m", "updated_at" = EXCLUDED."updated_at"`;
  }
}

async function seedTaxonomy(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  // parents first: the list is ordered so a parent precedes its children
  for (const [i, n] of TAXONOMY.entries()) {
    const parentId = n.parent ? ids.get(n.parent) : undefined;
    if (n.parent && !parentId) throw new Error(`taxonomy parent ${n.parent} must precede ${n.slug}`);
    const row = await tx.taxonomyNode.upsert({
      where: { slug: n.slug },
      update: { nameAr: n.nameAr, nameEn: n.nameEn, parentId: parentId ?? null, sortOrder: i },
      create: { slug: n.slug, nameAr: n.nameAr, nameEn: n.nameEn, parentId: parentId ?? null, sortOrder: i },
    });
    ids.set(n.slug, row.id);
  }
  return ids;
}

async function seedDemoRestaurant(tx: Tx, taxonomy: Map<string, string>): Promise<void> {
  const orgId = 'org_demo_abdullah';
  await tx.org.upsert({
    where: { id: orgId },
    update: { name: DEMO_RESTAURANT.name, cityId: DEMO_RESTAURANT.cityId },
    create: {
      id: orgId,
      type: 'restaurant',
      name: DEMO_RESTAURANT.name,
      cityId: DEMO_RESTAURANT.cityId,
      pauseWindows: [{ dow: 5, start: '11:45', end: '13:15', reason: 'صلاة الجمعة' }],
    },
  });
  await tx.merchantSettlement.upsert({
    where: { orgId },
    update: {},
    create: { orgId, mode: 'nightly_courier', exposureCapIqd: 300000 },
  });
  const catalog = await tx.catalog.upsert({
    where: { id: `${orgId}_catalog` },
    update: { nameAr: DEMO_RESTAURANT.catalogNameAr },
    create: { id: `${orgId}_catalog`, orgId, nameAr: DEMO_RESTAURANT.catalogNameAr },
  });
  for (const [i, item] of DEMO_RESTAURANT.items.entries()) {
    const itemId = `${orgId}_item_${String(i + 1).padStart(2, '0')}`;
    const taxonomyId = taxonomy.get(item.taxonomy) ?? null;
    await tx.catalogItem.upsert({
      where: { id: itemId },
      update: { nameAr: item.nameAr, nameEn: item.nameEn, priceIqd: item.priceIqd, prepTimeMin: item.prepTimeMin, taxonomyId },
      create: {
        id: itemId,
        catalogId: catalog.id,
        orgId,
        taxonomyId,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        priceIqd: item.priceIqd,
        prepTimeMin: item.prepTimeMin,
        hot: item.taxonomy !== 'soft_drinks' && item.taxonomy !== 'juice',
      },
    });
    for (const [g, group] of (item.modifierGroups ?? []).entries()) {
      const groupId = `${itemId}_mg_${g + 1}`;
      await tx.modifierGroup.upsert({
        where: { id: groupId },
        update: { nameAr: group.nameAr, nameEn: group.nameEn, required: group.required, maxSelect: group.max, minSelect: group.required ? 1 : 0 },
        create: { id: groupId, itemId, nameAr: group.nameAr, nameEn: group.nameEn, required: group.required, maxSelect: group.max, minSelect: group.required ? 1 : 0, sortOrder: g },
      });
      for (const [o, opt] of group.options.entries()) {
        const modId = `${groupId}_m_${o + 1}`;
        await tx.modifier.upsert({
          where: { id: modId },
          update: { nameAr: opt.nameAr, nameEn: opt.nameEn, priceIqd: opt.priceIqd },
          create: { id: modId, groupId, nameAr: opt.nameAr, nameEn: opt.nameEn, priceIqd: opt.priceIqd, sortOrder: o },
        });
      }
    }
  }
}

/** Pseudonymous person + vault identity + dispatcher role. The phone never touches `people`. */
async function seedDispatcher(tx: Tx): Promise<void> {
  const hash = phoneHash(DISPATCHER.phoneE164);
  const existing = await tx.personIdentity.findUnique({ where: { phoneHash: hash } });
  const personId =
    existing?.personId ??
    (await tx.person.create({ data: { id: 'person_demo_dispatcher', locale: DISPATCHER.locale, trustTier: 'gold', lastVerifiedAt: now() } })).id;
  await tx.personIdentity.upsert({
    where: { personId },
    update: { phoneE164: DISPATCHER.phoneE164, phoneHash: hash, name: DISPATCHER.name },
    create: { personId, phoneE164: DISPATCHER.phoneE164, phoneHash: hash, name: DISPATCHER.name },
  });
  for (const kind of ['dispatcher', 'support'] as const) {
    // (personId, kind, orgId) is unique but orgId is NULL here, which upsert cannot address: find-or-create.
    const r = await tx.role.findFirst({ where: { personId, kind, orgId: null } });
    if (r) await tx.role.update({ where: { id: r.id }, data: { revokedAt: null, frozenAt: null } });
    else await tx.role.create({ data: { personId, kind, grantedBy: 'seed' } });
  }
}

export async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await seedCities(tx);
    const zoneIds = await seedZones(tx);
    await seedMeetingPoints(tx, zoneIds);
    const taxonomy = await seedTaxonomy(tx);
    await seedDemoRestaurant(tx, taxonomy);
    await seedDispatcher(tx);
  }, { timeout: 60_000 });
}

const prisma = createPrisma(DATABASE_URL);
seed(prisma)
  .then(async () => {
    const [zones, mps, items] = await Promise.all([prisma.zone.count(), prisma.meetingPoint.count(), prisma.catalogItem.count()]);
    console.log(`seeded: ${CITIES.length} cities, ${zones} zones, ${mps} meeting points, ${TAXONOMY.length} taxonomy nodes, ${items} catalog items, 1 dispatcher`);
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error('seed failed', err);
    await prisma.$disconnect();
    process.exit(1);
  });
