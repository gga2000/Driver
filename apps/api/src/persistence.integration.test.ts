import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Actor } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { CatalogService } from './modules/catalog/index.js';
import { NotifyService } from './modules/notify/index.js';
import { IdentityService } from './modules/identity/index.js';
import { ORDER_COMPLIMENTS_REPOSITORY, OrdersService, type ComplimentRecord } from './modules/orders/index.js';
import { HouseholdsRpc, OrgsService } from './modules/orgs/index.js';
import { BLOB_STORE, PlacesService, SavedPlacesService, type BlobStore } from './modules/places/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * docs/persistence.md on a real Postgres (migrated + seeded): with DATABASE_URL the app's own wiring
 * binds the Prisma repositories, so orgs (merchant settings, households, payer approvals), saved places,
 * landmarks and upload records survive a restart — two boots of AppModule, nothing shared but the
 * database (and UPLOADS_DIR for the dev store's bytes) — and the seeded launch restaurants take orders.
 * Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };

describe.skipIf(!url)('persistence across restarts (needs DATABASE_URL)', () => {
  const clock = new FakeClock('2026-10-03T10:00:00Z'); // Saturday 13:00 in Baghdad: kitchens open, no prayer pause
  const run = Date.now().toString(36);
  const phone = (n: number) => `0771${String((Date.now() + n) % 10_000_000).padStart(7, '0')}`;
  const env = { UPLOADS_DIR: process.env['UPLOADS_DIR'], UPLOADS_SECRET: process.env['UPLOADS_SECRET'] };
  const dir = mkdtempSync(join(tmpdir(), 'driver-uploads-'));
  const created = { orgs: [] as string[], places: [] as string[], uploads: [] as string[], orders: [] as string[] };

  /** Lets the outbox worker deliver what this boot wrote before the app (and its Prisma client) closes. */
  async function close(app: INestApplication): Promise<void> {
    const db = app.get(PrismaService).prisma;
    for (let i = 0; i < 100 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  }

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    const app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    return app;
  }

  beforeAll(() => {
    process.env['UPLOADS_DIR'] = dir;
    process.env['UPLOADS_SECRET'] = `persistence-${run}`;
  });

  afterAll(async () => {
    const prisma = new PrismaService(url);
    const db = prisma.prisma;
    await db.orderLine.deleteMany({ where: { orderId: { in: created.orders } } });
    await db.participant.deleteMany({ where: { orderId: { in: created.orders } } });
    await db.order.deleteMany({ where: { id: { in: created.orders } } });
    await db.payerApproval.deleteMany({ where: { orgId: { in: created.orgs } } });
    await db.householdInvite.deleteMany({ where: { orgId: { in: created.orgs } } });
    await db.orgMember.deleteMany({ where: { orgId: { in: created.orgs } } });
    await db.org.deleteMany({ where: { id: { in: created.orgs } } });
    await db.placePhoto.deleteMany({ where: { placeId: { in: created.places } } });
    await db.place.deleteMany({ where: { id: { in: created.places } } });
    await db.upload.deleteMany({ where: { id: { in: created.uploads } } });
    await prisma.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const as = (personId: string): Actor => ({ personId, sessionId: `s_${run}` });
  const state = { ali: '', minar: '', storeId: '', homeId: '', approvalId: '', placeId: '', uploadId: '', landmarkId: '', proposedId: '' };

  it('first boot: writes merchant settings, a household with an approved request, a saved place with a gate photo, a landmark', async () => {
    const app = await boot();
    try {
      const identity = app.get(IdentityService);
      const orgs = app.get(OrgsService);
      const households = app.get(HouseholdsRpc);
      const saved = app.get(SavedPlacesService);
      const blobs = app.get<BlobStore>(BLOB_STORE);
      state.ali = await identity.ensurePersonByPhone(phone(1), 'system:test', 'persistence_test');

      const store = await orgs.create({ type: 'restaurant', name: `مطعم ${run}`, cityId: 'aziziyah', ownerId: state.ali });
      state.storeId = store.id;
      created.orgs.push(store.id);
      const at = clock.now();
      await orgs.setMerchantSettings(store.id, {
        location: { zoneKey: 'centre', pin: KITCHEN },
        defaultPrepMin: 18,
        commissionTier: 'featured',
        autoAccept: true,
        pauseWindows: [{ dow: 5, start: '11:30', end: '13:30', reason: 'صلاة الجمعة' }],
        busyUntil: new Date(at.getTime() + 30 * 60_000),
        printer: { state: 'disconnected', name: 'XP-58', at },
      });
      // A quick pause from المحل keeps when it opens again (orgs.closed_until).
      await orgs.setMerchantSettings(store.id, { closed: { reason: 'sold_out', note: 'خلص اللحم', at, until: new Date(at.getTime() + 20 * 60_000) } });
      await orgs.setMerchantSettings(store.id, {
        openingHours: [
          { dow: 0, start: '12:00', end: '15:30' },
          { dow: 0, start: '18:00', end: '01:00' },
        ],
        holidays: [{ from: '2026-10-20', to: '2026-10-22', note: 'عيد' }],
        hoursUpdatedAt: at,
      });
      await orgs.setMerchantSettings(store.id, { pickupSpot: { note: 'الاستلام من الشباك اليسار', photoRefs: [`up_pickup_${run}`], updatedAt: at } });
      await orgs.heartbeat(store.id, at);

      const home = await households.create(as(state.ali), { name: 'بيت علي', cityId: 'aziziyah' });
      state.homeId = home.id;
      created.orgs.push(home.id);
      const minarPhone = phone(2);
      const invited = await households.inviteMember(as(state.ali), { householdId: home.id, phone: minarPhone, role: 'orderer', spendingLimitIqd: 25_000 });
      expect(invited.members).toHaveLength(1);
      // SEC-06: Minar joins by saying yes (the invite row is on Postgres too).
      state.minar = (await identity.personIdByPhone(minarPhone))!;
      const [invite] = await households.myInvites(as(state.minar));
      const withMinar = await households.respondInvite(as(state.minar), { inviteId: invite!.id, accept: true });
      expect(withMinar?.members.map((m) => m.personId)).toEqual([state.ali, state.minar]);
      const req = await orgs.requestPayerApproval({ orgId: home.id, orderId: `ord_${run}`, requestedBy: state.minar, amountIqd: 31_000 });
      state.approvalId = req.id;
      await households.approve(as(state.ali), { requestId: req.id });

      const ticket = await blobs.createUpload({ ownerId: state.ali, contentType: 'image/jpeg', sizeBytes: JPEG.length });
      state.uploadId = ticket.uploadId;
      created.uploads.push(ticket.uploadId);
      const u = new URL(ticket.uploadUrl, 'http://api');
      await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp') ?? undefined, sig: u.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
      const place = await saved.save(state.ali, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: STREET_30, note: 'باب أخضر', photoIds: [ticket.uploadId], shareWithHousehold: true, landmarkId: 'lm_mp_shari_30', clientRef: `device:${run}` });
      state.placeId = place.id;
      created.places.push(place.id);
      await saved.confirm(state.ali, { placeId: place.id, pin: STREET_30, accuracyM: 10 });

      const landmark = await app.get(PlacesService).save({ cityId: 'aziziyah', pin: KITCHEN, name: `جامع ${run}`, photos: [{ id: 'p1', url: 'https://example.test/mosque.jpg' }], confidence: 1, sharedWith: [], landmark: true, landmarkCategory: 'mosque' });
      state.landmarkId = landmark.id;
      created.places.push(landmark.id);
      // A landmark still waiting for the Console is not one yet (maps b3: the map shows approved only).
      const proposed = await app.get(PlacesService).save({ cityId: 'aziziyah', pin: KITCHEN, name: `مدرسة ${run}`, photos: [], confidence: 1, sharedWith: [], landmark: true, landmarkState: 'proposed' });
      state.proposedId = proposed.id;
      created.places.push(proposed.id);

      // Every change committed with its event (one transaction): the org stream is in Postgres.
      const prisma = app.get(PrismaService).prisma;
      const types = (await prisma.event.findMany({ where: { aggregate: 'org', aggregateId: home.id }, select: { type: true } })).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['org.created', 'org.member_added', 'org.payer_approval_requested', 'org.payer_approved']));
    } finally {
      await close(app);
    }
  });

  it('second boot: everything is read back from Postgres', async () => {
    const app = await boot();
    try {
      const orgs = app.get(OrgsService);
      const at = clock.now();
      const store = await orgs.get(state.storeId);
      expect(store).toMatchObject({ type: 'restaurant', name: `مطعم ${run}`, members: [{ personId: state.ali, role: 'member', spendingLimitIqd: null }] });
      expect(await orgs.merchantSettings(state.storeId)).toEqual({
        autoAccept: true,
        pauseWindows: [{ dow: 5, start: '11:30', end: '13:30', reason: 'صلاة الجمعة' }],
        lastHeartbeatAt: at,
        defaultPrepMin: 18,
        commissionTier: 'featured',
        location: { zoneKey: 'centre', pin: KITCHEN },
        busyUntil: new Date(at.getTime() + 30 * 60_000),
        closed: { reason: 'sold_out', note: 'خلص اللحم', at, until: new Date(at.getTime() + 20 * 60_000) },
        printer: { state: 'disconnected', name: 'XP-58', at },
        openingHours: [
          { dow: 0, start: '12:00', end: '15:30' },
          { dow: 0, start: '18:00', end: '01:00' },
        ],
        holidays: [{ from: '2026-10-20', to: '2026-10-22', note: 'عيد' }],
        hoursUpdatedAt: at,
        pickupSpot: { note: 'الاستلام من الشباك اليسار', photoRefs: [`up_pickup_${run}`], updatedAt: at },
      });
      expect((await orgs.merchants('aziziyah')).map((m) => m.id)).toEqual(expect.arrayContaining([state.storeId, ...AZIZIYAH_RESTAURANTS.map((r) => r.orgId)]));

      const home = await app.get(HouseholdsRpc).mine(as(state.minar));
      expect(home).toMatchObject({ id: state.homeId, myRole: 'orderer' });
      expect(home!.members.map((m) => [m.role, m.spendingLimitIqd])).toEqual([
        ['payer', null],
        ['orderer', 25_000],
      ]);
      expect(await orgs.approval(state.approvalId)).toMatchObject({ state: 'approved', payerId: state.ali, amountIqd: 31_000 });
      expect(await orgs.withinLimit(state.homeId, state.minar, 31_000)).toBe(false);

      // Saved place: owner and household member both see it; the gate photo is a signed URL that still reads.
      const [mine] = await app.get(SavedPlacesService).mine(state.ali);
      expect(mine).toMatchObject({ id: state.placeId, label: 'home', zoneId: 'street_30', pin: STREET_30, note: 'باب أخضر', confirmed: true, sharedWithHousehold: true, access: 'owner', landmark: { id: 'lm_mp_shari_30', name_ar: 'تقاطع شارع 30' } });
      expect((await app.get(SavedPlacesService).mine(state.minar)).map((p) => [p.id, p.access])).toEqual([[state.placeId, 'household']]);
      const photoUrl = new URL(mine!.photos[0]!.url, 'http://api');
      const blobs = app.get<BlobStore>(BLOB_STORE);
      expect(await blobs.get(state.uploadId)).toMatchObject({ ownerId: state.ali, state: 'stored', sizeBytes: JPEG.length });
      const file = await blobs.read({ id: state.uploadId, exp: photoUrl.searchParams.get('exp') ?? undefined, sig: photoUrl.searchParams.get('sig') ?? undefined });
      expect(file?.bytes.equals(JPEG)).toBe(true);
      // Offline retry with the same client ref returns the same place.
      const again = await app.get(SavedPlacesService).save(state.ali, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: STREET_30, photoIds: [], shareWithHousehold: true, clientRef: `device:${run}` });
      expect(again.id).toBe(state.placeId);

      const places = app.get(PlacesService);
      expect((await places.landmarks('aziziyah')).find((p) => p.id === state.landmarkId)).toMatchObject({ name: `جامع ${run}`, pin: KITCHEN, photos: [{ url: 'https://example.test/mosque.jpg' }], landmarkCategory: 'mosque', landmarkState: 'approved' });
      expect((await places.landmarks('aziziyah')).some((p) => p.id === state.proposedId)).toBe(false);
      expect(await places.get(state.proposedId)).toMatchObject({ landmarkState: 'proposed' });
      expect((await places.get(state.proposedId))?.landmarkCategory).toBeUndefined();
      const near = await places.nearby('aziziyah', { lat: KITCHEN.lat + 0.001, lng: KITCHEN.lng }, 0.5);
      expect(near.find((p) => p.id === state.landmarkId)?.distanceKm).toBeCloseTo(0.111, 2);
      expect(near.some((p) => p.id === state.placeId)).toBe(false); // saved places are not city knowledge
      expect((await places.reinforce(state.landmarkId, -0.25))?.confidence).toBeCloseTo(0.75, 6);
    } finally {
      await close(app);
    }
  });

  it('the seeded launch restaurants are orderable: kitchen, prep time and Friday pause come from their org rows', async () => {
    const app = await boot();
    try {
      const orgs = app.get(OrgsService);
      for (const r of AZIZIYAH_RESTAURANTS) {
        expect(await orgs.merchantSettings(r.orgId)).toMatchObject({ location: { zoneKey: r.zoneKey, pin: r.pin }, defaultPrepMin: r.prepMin, commissionTier: 'base', pauseWindows: [{ dow: 5, start: '11:45', end: '13:15' }] });
      }
      const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
      const order = await app.get(OrdersService).place(state.ali, {
        cityId: 'aziziyah',
        type: 'food',
        merchantOrgId: khalid.orgId,
        lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 8 }],
        dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      });
      created.orders.push(order.id);
      expect(order).toMatchObject({ state: 'placed', merchantOrgId: khalid.orgId });
      expect(order.lines[0]).toMatchObject({ catalogItemId: `${khalid.orgId}_pepsi`, unitPriceIqd: 750, qty: 8 });
    } finally {
      await close(app);
    }
  });

  it('joy J7a: today\'s pot, a dish follow, the dish-pot switch and the kitchen story survive a restart', async () => {
    const kareem = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'haj_kareem')!;
    const bamia = `${kareem.orgId}_rice_bamia`;
    const fan = `fan_${run}`;
    let app = await boot();
    try {
      const catalog = app.get(CatalogService);
      const { followerIds } = await catalog.postPot(kareem.orgId, { itemId: bamia, note: 'ويا لحم غنم', until: '16:00' }, state.ali);
      expect(followerIds).not.toContain(fan);
      await catalog.followDish(fan, kareem.orgId, bamia, true);
      await catalog.setStory(kareem.orgId, { text: 'من أيام أبوي.', sinceYear: 1998, shown: true });
      await app.get(NotifyService).setPreferences({ personId: fan, sessionId: 's' }, { dishPots: false });
    } finally {
      await close(app);
    }
    app = await boot();
    try {
      const catalog = app.get(CatalogService);
      expect(await catalog.showingPot(kareem.orgId)).toMatchObject({ itemId: bamia, note: 'ويا لحم غنم', until: '16:00', localDate: '2026-10-03' });
      expect((await catalog.dishFollows(fan)).map((f) => f.itemId)).toEqual([bamia]);
      expect((await catalog.followerCounts(kareem.orgId)).get(bamia)).toBe(1);
      expect((await catalog.storefront(kareem.orgId))?.story).toMatchObject({ text: 'من أيام أبوي.', sinceYear: 1998, shown: true });
      expect(await app.get(NotifyService).preferences({ personId: fan, sessionId: 's' })).toMatchObject({ dishPots: false, marketing: false });
      // Leave the shared database as the seed wrote it.
      await catalog.clearPot(kareem.orgId);
      await catalog.followDish(fan, kareem.orgId, bamia, false);
      const front = (await catalog.storefront(kareem.orgId))!;
      await catalog.saveStorefront({ ...front, story: null });
      await app.get(PrismaService).prisma.notifyPreference.deleteMany({ where: { personId: fan } });
    } finally {
      await close(app);
    }
  });

  it('joy l4: a customer\'s compliments for a courier survive a restart, one row per order', async () => {
    const orderId = `ord_cmp_${run}`;
    const courierId = `courier_cmp_${run}`;
    type Repo = { create(c: Omit<ComplimentRecord, 'id'>): Promise<ComplimentRecord>; forCourier(id: string): Promise<ComplimentRecord[]>; forOrder(id: string): Promise<ComplimentRecord | null> };
    let app = await boot();
    try {
      const repo = app.get<Repo>(ORDER_COMPLIMENTS_REPOSITORY);
      await repo.create({ orderId, courierId, customerId: `cust_${run}`, orderType: 'food', keys: ['polite', 'hot_food'], createdAt: clock.now() });
      // A racing second send keeps the first words.
      expect((await repo.create({ orderId, courierId, customerId: `cust_${run}`, orderType: 'food', keys: ['fast'], createdAt: clock.now() })).keys).toEqual(['polite', 'hot_food']);
    } finally {
      await close(app);
    }
    app = await boot();
    try {
      const repo = app.get<Repo>(ORDER_COMPLIMENTS_REPOSITORY);
      expect((await repo.forOrder(orderId))?.keys).toEqual(['polite', 'hot_food']);
      expect((await repo.forCourier(courierId)).map((r) => r.orderId)).toEqual([orderId]);
      await app.get(PrismaService).prisma.orderCompliment.deleteMany({ where: { orderId } });
    } finally {
      await close(app);
    }
  });
});
