/**
 * `pnpm db:seed` — idempotent seed for a local Driver database (plan Step 1).
 *
 * Writes: 3 cities, the 34 Aziziyah zones with draft hexagon polygons (tier + extId), 4 garages and
 * 6 street-pickup meeting points (plus the الرجعة drafts: a Kut garage and 3 on-the-way points),
 * taxonomy roots, a demo restaurant org with a 10-item catalog
 * (modifier groups included), the four launch restaurants with storefronts and sectioned menus
 * (M3) — each an orderable merchant org: kitchen pin (PostGIS) and zone, prep time, commission tier,
 * Friday-prayer pause — and a dispatcher person whose phone lives only in the vault.
 * `SEED_PROFILE=production` skips the demo restaurant and dispatcher; `SEED_ADMIN_PHONE` adds the first
 * admin (seed-data.ts `SeedOptions`, docs/deploy/supabase.md). Re-running updates in place; nothing is duplicated.
 */
import { createHmac } from 'node:crypto';
import { createPrisma, dbOptionsFromEnv, type PrismaClient, type Tx } from '../src/index.js';
import {
  AZIZIYAH_RESTAURANTS,
  AZIZIYAH_ZONES,
  CITIES,
  DEMO_RESTAURANT,
  DISPATCHER,
  INTERCITY_DRAFT_POINTS,
  MEETING_POINTS,
  TAXONOMY,
  hexagonWkt,
  pointWkt,
  seedOptionsFromEnv,
  storefrontJson,
  type SeedOptions,
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

/** Day-1 order-taking defaults for a seeded kitchen (Friday prayer pause; money §1 base tier). */
const FRIDAY_PRAYER = [{ dow: 5, start: '11:45', end: '13:15', reason: 'صلاة الجمعة' }];

/**
 * What `orders.place` reads through the orgs module: the kitchen's zone + pin (couriers' pickup and the
 * delivery quote), prep time and commission tier. The pin is PostGIS geography, so it goes in with SQL.
 * Re-running resets the seeded values; busy mode, early close and the printer marker are left alone.
 */
async function seedMerchantSettings(tx: Tx, orgId: string, s: { zoneKey: string; pin: { lat: number; lng: number }; prepMin: number }): Promise<void> {
  await tx.$executeRaw`
    UPDATE "public"."orgs" SET
      "location_zone_key" = ${s.zoneKey},
      "location_pin" = ST_GeogFromText(${pointWkt(s.pin)}),
      "default_prep_min" = ${s.prepMin},
      "commission_tier" = 'base',
      "updated_at" = ${now()}
    WHERE "id" = ${orgId}`;
}

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
      pauseWindows: FRIDAY_PRAYER,
    },
  });
  const centre = AZIZIYAH_ZONES.find((z) => z.id === DEMO_RESTAURANT.zoneKey)!;
  await seedMerchantSettings(tx, orgId, { zoneKey: DEMO_RESTAURANT.zoneKey, pin: { lat: centre.lat, lng: centre.lng }, prepMin: 15 });
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

/**
 * M3: the four launch restaurants — org, settlement, a main menu carrying the storefront JSON, and
 * sectioned items with modifier groups. Ids are the shared stable ids (`@driver/contracts/seeds`).
 */
async function seedLaunchRestaurants(tx: Tx, taxonomy: Map<string, string>): Promise<void> {
  for (const r of AZIZIYAH_RESTAURANTS) {
    const orgId = r.orgId;
    await tx.org.upsert({
      where: { id: orgId },
      update: { name: r.nameAr, cityId: r.cityId },
      create: { id: orgId, type: 'restaurant', name: r.nameAr, cityId: r.cityId, pauseWindows: FRIDAY_PRAYER },
    });
    await seedMerchantSettings(tx, orgId, { zoneKey: r.zoneKey, pin: r.pin, prepMin: r.prepMin });
    await tx.merchantSettlement.upsert({ where: { orgId }, update: {}, create: { orgId, mode: 'nightly_courier', exposureCapIqd: 300000 } });
    const storefront = storefrontJson(r) as never;
    const catalog = await tx.catalog.upsert({
      where: { id: `${orgId}_catalog` },
      update: { nameAr: 'القائمة الرئيسية', storefront },
      create: { id: `${orgId}_catalog`, orgId, nameAr: 'القائمة الرئيسية', storefront },
    });
    let sortOrder = 0;
    for (const category of r.categories) {
      for (const item of category.items) {
        const itemId = `${orgId}_${item.key}`;
        const taxonomyId = taxonomy.get(item.taxonomy) ?? null;
        const fields = {
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          description: item.descriptionAr ?? null,
          priceIqd: item.priceIqd,
          prepTimeMin: item.prepTimeMin,
          taxonomyId,
          categoryAr: category.nameAr,
          sortOrder: sortOrder++,
          hot: item.taxonomy !== 'soft_drinks' && item.taxonomy !== 'juice',
        };
        await tx.catalogItem.upsert({ where: { id: itemId }, update: fields, create: { id: itemId, catalogId: catalog.id, orgId, ...fields } });
        for (const [g, group] of (item.modifierGroups ?? []).entries()) {
          const groupId = `${itemId}_mg_${g + 1}`;
          const min = group.min ?? (group.required ? 1 : 0);
          const gFields = { nameAr: group.nameAr, nameEn: group.nameEn, required: group.required, minSelect: min, maxSelect: group.max, sortOrder: g };
          await tx.modifierGroup.upsert({ where: { id: groupId }, update: gFields, create: { id: groupId, itemId, ...gFields } });
          for (const [o, opt] of group.options.entries()) {
            const modId = `${groupId}_m_${o + 1}`;
            const mFields = { nameAr: opt.nameAr, nameEn: opt.nameEn, priceIqd: opt.priceIqd, sortOrder: o };
            await tx.modifier.upsert({ where: { id: modId }, update: mFields, create: { id: modId, groupId, ...mFields } });
          }
        }
      }
    }
  }
}

/** Pseudonymous person + vault identity + staff roles. The phone never touches `people`. */
async function seedStaff(
  tx: Tx,
  p: { id: string; phoneE164: string; name: string; locale: string; roles: ReadonlyArray<'dispatcher' | 'support' | 'finance' | 'admin'> },
): Promise<void> {
  const hash = phoneHash(p.phoneE164);
  const existing = await tx.personIdentity.findUnique({ where: { phoneHash: hash } });
  const personId =
    existing?.personId ?? (await tx.person.create({ data: { id: p.id, locale: p.locale, trustTier: 'gold', lastVerifiedAt: now() } })).id;
  await tx.personIdentity.upsert({
    where: { personId },
    update: { phoneE164: p.phoneE164, phoneHash: hash, name: p.name },
    create: { personId, phoneE164: p.phoneE164, phoneHash: hash, name: p.name },
  });
  for (const kind of p.roles) {
    // (personId, kind, orgId) is unique but orgId is NULL here, which upsert cannot address: find-or-create.
    const r = await tx.role.findFirst({ where: { personId, kind, orgId: null } });
    if (r) await tx.role.update({ where: { id: r.id }, data: { revokedAt: null, frozenAt: null } });
    else await tx.role.create({ data: { personId, kind, grantedBy: 'seed' } });
  }
}

/** The demo dispatcher (local development, the simulator's Console). Never in production. */
async function seedDispatcher(tx: Tx): Promise<void> {
  await seedStaff(tx, { id: 'person_demo_dispatcher', ...DISPATCHER, roles: ['dispatcher', 'support'] });
}

export async function seed(prisma: PrismaClient, opts: SeedOptions = { profile: 'dev' }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await seedCities(tx);
    const zoneIds = await seedZones(tx);
    await seedMeetingPoints(tx, zoneIds);
    const taxonomy = await seedTaxonomy(tx);
    if (opts.profile === 'dev') await seedDemoRestaurant(tx, taxonomy);
    await seedLaunchRestaurants(tx, taxonomy);
    if (opts.profile === 'dev') await seedDispatcher(tx);
    if (opts.admin) await seedStaff(tx, { id: 'person_admin', locale: 'ar-IQ', ...opts.admin, roles: ['admin', 'dispatcher', 'support', 'finance'] });
  }, { timeout: 60_000 });
}

const options = seedOptionsFromEnv(process.env);
if (options.profile === 'production' && options.admin && !process.env['PHONE_HASH_PEPPER']) {
  console.error('SEED_ADMIN_PHONE in production needs the production PHONE_HASH_PEPPER, or the admin could never sign in.');
  process.exit(1);
}
const prisma = createPrisma(DATABASE_URL, dbOptionsFromEnv());
seed(prisma, options)
  .then(async () => {
    const [zones, mps, items, merchants] = await Promise.all([
      prisma.zone.count(),
      prisma.meetingPoint.count(),
      prisma.catalogItem.count(),
      prisma.org.count({ where: { type: { in: ['restaurant', 'grocer'] }, locationZoneKey: { not: null } } }),
    ]);
    const staff = [options.profile === 'dev' ? '1 demo dispatcher' : '', options.admin ? '1 admin' : ''].filter(Boolean).join(', ') || 'no staff';
    console.log(`seeded (${options.profile}): ${CITIES.length} cities, ${zones} zones, ${mps} meeting points, ${TAXONOMY.length} taxonomy nodes, ${merchants} orderable merchants, ${items} catalog items, ${staff}`);
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error('seed failed', err);
    await prisma.$disconnect();
    process.exit(1);
  });
