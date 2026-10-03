import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AppContext, MenuItem, RestaurantCard } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { RecordingOrderEvents } from '../orders/events.adapter.js';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { InMemoryOrdersRepository } from '../orders/orders.repository.js';
import { OrdersService, type OrderTimerJob } from '../orders/orders.service.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { FakeCashRisk, FakePromotions, fakePhoneHash } from '../orders/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryTripsRepository, RecordingTripEvents, ScriptedOfferCheck, TripsService, type TripTimerJob } from '../trips/index.js';
import { InMemoryCatalogRepository } from './catalog.repository.js';
import { CatalogRpc } from './catalog.rpc.js';
import { CatalogService } from './catalog.service.js';
import { seedStorefronts } from './seed.js';

/** Saturday 2026-10-03 18:12 Baghdad: the three dinner kitchens are open, المسافر (5:00–15:00) is not. */
const SAT_EVENING = '2026-10-03T15:12:00Z';
const ZAKUR = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
const CENTRE_HOME = { zoneKey: 'centre' };

async function world(at = SAT_EVENING) {
  const clock = new FakeClock(at);
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository());
  const pricing = new PricingService(new ConfigService());
  const rpc = new CatalogRpc(catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(orgs)), pricing, clock);
  const seeded = await seedStorefronts(orgs, catalog);
  const byKey = (key: string) => seeded.find((s) => s.seed.key === key)!;
  return { clock, orgs, catalog, pricing, rpc, seeded, byKey };
}

function caller(rpc: CatalogRpc, personId: string | null = 'c1') {
  const ctx = {
    auth: personId ? { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async () => false },
    catalog: rpc,
  } as unknown as AppContext;
  return t.createCallerFactory(appRouter)(ctx).catalog;
}

const ACTOR = { personId: 'c1', sessionId: 's1' };

describe('catalog.restaurants (customer read, M3)', () => {
  it('lists the four launch kitchens with fee preview, ETA, minimum and open state — through the router', async () => {
    const w = await world();
    const cards = await caller(w.rpc).restaurants({ cityId: 'aziziyah', dropoff: ZAKUR });
    expect(cards.map((c) => c.name).sort()).toEqual(['مأكولات الشام', 'مشويات الحاج كريم', 'مطعم المسافر', 'مطعم خالد'].sort());
    // Closed last.
    expect(cards.at(-1)?.name).toBe('مطعم المسافر');
    const musafir = cards.find((c) => c.name === 'مطعم المسافر')!;
    expect(musafir).toMatchObject({ open: false, closedReason: 'hours', opensAt: '5:00', minOrderIqd: 8000 });
    for (const c of cards.filter((x) => x.name !== 'مطعم المسافر')) expect(c.open, c.name).toBe(true);

    const kareem = cards.find((c) => c.name === 'مشويات الحاج كريم')!;
    // centre → zakur (mid): 1,000 delivery + 500 service, the same split orders charges.
    expect(kareem).toMatchObject({ deliveryFeeIqd: 1000, serviceFeeIqd: 500, minOrderIqd: 7000, cuisine: 'مشويات · دجاج · تمن ومرق', photoUrl: null, busy: false });
    expect(kareem.rating).toEqual({ avg: 4.8, count: 527 });
    expect(kareem.pickup).toEqual({ zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } });
    expect(kareem.prepMinMinutes).toBe(25);
    expect(kareem.prepMaxMinutes).toBe(35);
    expect(kareem.etaMinMinutes).toBeGreaterThan(kareem.prepMinMinutes);
    expect(kareem.etaMinMinutes! % 5).toBe(0);
    expect(kareem.etaMaxMinutes! - kareem.etaMinMinutes!).toBe(10);
  });

  it('without a deliver-to point there is no fee preview or ETA (prep only)', async () => {
    const w = await world();
    const [card] = await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', filters: { query: 'خالد' } });
    expect(card).toMatchObject({ name: 'مطعم خالد', deliveryFeeIqd: null, serviceFeeIqd: null, etaMinMinutes: null, etaMaxMinutes: null, prepMinMinutes: 20 });
  });

  it('the fee preview follows the zone pair (same zone is the cheapest)', async () => {
    const w = await world();
    const cards = await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: CENTRE_HOME, filters: {} });
    const kareem = cards.find((c) => c.name === 'مشويات الحاج كريم')!;
    const far = (await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: { zoneKey: 'khamas' }, filters: {} })).find((c) => c.name === 'مشويات الحاج كريم')!;
    expect(kareem.deliveryFeeIqd!).toBeLessThan(far.deliveryFeeIqd!);
  });

  it('filters: open now, cuisine tag, free delivery, and search over names, cuisine and dishes (Arabic folding)', async () => {
    const w = await world();
    const names = (cards: RestaurantCard[]) => cards.map((c) => c.name).sort();
    const list = (filters: object) => w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: ZAKUR, filters });
    expect(names(await list({ openNow: true }))).not.toContain('مطعم المسافر');
    expect(names(await list({ tag: 'breakfast' }))).toEqual(['مطعم المسافر']);
    expect(names(await list({ query: 'شاورما' }))).toEqual(['مأكولات الشام']);
    // A dish name finds both grills; hamza and ta-marbuta folding: "مشكل" matches "مشكّل".
    expect(names(await list({ query: 'كباب' }))).toEqual(['مشويات الحاج كريم', 'مطعم خالد'].sort());
    expect(names(await list({ query: 'مشكل' }))).toEqual(['مشويات الحاج كريم', 'مطعم خالد'].sort());
    expect(names(await list({ query: 'چاي' }))).toEqual(['مطعم المسافر']);
    expect(await list({ freeDelivery: true })).toEqual([]);
    expect(await w.rpc.restaurants(ACTOR, { cityId: 'kut', filters: {} })).toEqual([]);
  });

  it('Friday prayer pauses every kitchen (city default) and says when it reopens', async () => {
    // Friday 2026-10-09 12:00 Baghdad.
    const w = await world('2026-10-09T09:00:00Z');
    const cards = await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', filters: {} });
    const kareem = cards.find((c) => c.name === 'مشويات الحاج كريم')!;
    expect(kareem).toMatchObject({ open: false, closedReason: 'paused', opensAt: '1:15' });
  });

  it('busy mode widens prep and ETA by the busy buffer', async () => {
    const w = await world();
    const khalid = w.byKey('khalid');
    const before = (await w.rpc.menu(ACTOR, { merchantId: khalid.orgId, dropoff: ZAKUR })).restaurant;
    w.catalog.setBusy(khalid.orgId, true);
    const after = (await w.rpc.menu(ACTOR, { merchantId: khalid.orgId, dropoff: ZAKUR })).restaurant;
    expect(after.busy).toBe(true);
    expect(after.prepMinMinutes - before.prepMinMinutes).toBe(10);
    expect(after.etaMinMinutes! - before.etaMinMinutes!).toBe(10);
  });

  it('requires a signed-in person (no role needed)', async () => {
    const w = await world();
    const err = await caller(w.rpc, null)
      .restaurants({ cityId: 'aziziyah' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe('UNAUTHORIZED');
  });
});

describe('catalog.menu', () => {
  it('returns sections in menu order with variants first and the min/max rules — through the router', async () => {
    const w = await world();
    const khalid = w.byKey('khalid');
    const menu = await caller(w.rpc).menu({ merchantId: khalid.orgId, dropoff: ZAKUR });
    expect(menu.restaurant.name).toBe('مطعم خالد');
    expect(menu.categories.map((c) => c.name)).toEqual(['لفات', 'وجبات', 'شوربة ومقبلات', 'مشروبات']);
    const items = menu.categories.flatMap((c) => c.items);
    const byName = (n: string) => items.find((i) => i.name === n)!;

    const wrap = byName('لفة كباب');
    expect(wrap).toMatchObject({ priceIqd: 2000, available: true, unavailableReason: null, description: 'شيش كباب غنم على الفحم، بصل بالسماق وطماطة' });
    expect(wrap.modifierGroups.map((g) => [g.name, g.required, g.min, g.max, g.variant])).toEqual([
      ['الخبز', true, 1, 1, false],
      ['إضافات', false, 0, 3, false],
    ]);
    expect(wrap.modifierGroups[1]!.modifiers.map((m) => m.priceIqd)).toEqual([0, 0, 250, 500]);

    const kilo = byName('كباب بالكيلو');
    expect(kilo.modifierGroups[0]).toMatchObject({ name: 'الكمية', variant: true, min: 1, max: 1 });
    expect(kilo.modifierGroups[0]!.modifiers.map((m) => [m.name, m.priceIqd])).toEqual([
      ['نص كيلو', 0],
      ['كيلو', 11000],
    ]);
    expect(byName('بيبسي').modifierGroups).toEqual([]);
    // Ids are the stable seed ids under this process's org id.
    expect(wrap.id).toBe(`${khalid.orgId}_kebab_wrap`);
    expect(wrap.modifierGroups[0]!.modifiers[0]!.id).toBe(`${khalid.orgId}_kebab_wrap_mg_1_m_1`);
  });

  it('a sold-out item stays on the menu, marked; an unknown merchant is org_not_found', async () => {
    const w = await world();
    const sham = w.byKey('sham');
    await w.catalog.setAvailable(sham.itemIds.get('falafel_plate')!, false);
    const menu = await w.rpc.menu(ACTOR, { merchantId: sham.orgId });
    const plate = menu.categories.flatMap((c) => c.items).find((i) => i.name === 'صحن فلافل') as MenuItem;
    expect(plate).toMatchObject({ available: false, unavailableReason: 'sold_out' });
    await expect(w.rpc.menu(ACTOR, { merchantId: 'org_nope' })).rejects.toMatchObject({ code: 'org_not_found' });
  });
});

describe('the menu and fee preview are what orders.place charges (no price_changed at checkout)', () => {
  it('a two-person cart priced from catalog.menu + the card fees is accepted as sent', async () => {
    const w = await world();
    const clock = w.clock;
    const uow = new UnitOfWork(new NoDatabaseRunner());
    const tripsQueue = new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now());
    const trips = new TripsService(new InMemoryTripsRepository(), new RecordingTripEvents(), uow, clock, tripsQueue);
    trips.onModuleInit();
    trips.bindOfferCheck(new ScriptedOfferCheck());
    const cashRisk = new FakeCashRisk();
    cashRisk.prior.set('c1', 3);
    const orders = new OrdersService(
      new InMemoryOrdersRepository(),
      new RecordingOrderEvents(),
      uow,
      clock,
      new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now()),
      trips,
      w.pricing,
      new OrgsMerchantDirectory(w.orgs),
      { resolvePhone: async (phone) => ({ personId: null, phoneHash: fakePhoneHash(phone) }) },
      cashRisk,
      w.catalog,
      new FakePromotions(),
    );
    orders.onModuleInit();

    const khalid = w.byKey('khalid');
    const menu = await w.rpc.menu(ACTOR, { merchantId: khalid.orgId, dropoff: ZAKUR });
    const items = menu.categories.flatMap((c) => c.items);
    const wrap = items.find((i) => i.name === 'لفة تكة')!;
    const kilo = items.find((i) => i.name === 'كباب بالكيلو')!;
    const [breadGroup, extrasGroup] = wrap.modifierGroups;
    const tannour = breadGroup!.modifiers[1]!;
    const cheese = extrasGroup!.modifiers.find((m) => m.name === 'جبن')!;
    const kiloOpt = kilo.modifierGroups[0]!.modifiers[1]!;

    const order = await orders.place('c1', {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      participants: [{ ref: 'p_sara', role: 'diner', label: 'سارة', phone: '07701234567', note: 'بدون بصل' }],
      lines: [
        {
          catalogItemId: wrap.id,
          qty: 2,
          unitPriceIqd: wrap.priceIqd,
          modifiers: [
            { groupId: breadGroup!.id, modifierId: tannour.id, priceIqd: tannour.priceIqd },
            { groupId: extrasGroup!.id, modifierId: cheese.id, priceIqd: cheese.priceIqd },
          ],
          participantRef: 'p_sara',
          merchantOrgId: khalid.orgId,
        },
        { catalogItemId: kilo.id, qty: 1, unitPriceIqd: kilo.priceIqd, modifiers: [{ groupId: kilo.modifierGroups[0]!.id, modifierId: kiloOpt.id, priceIqd: kiloOpt.priceIqd }], merchantOrgId: khalid.orgId },
      ],
      dropoff: ZAKUR,
      deliveryFeeIqd: menu.restaurant.deliveryFeeIqd!,
      serviceFeeIqd: menu.restaurant.serviceFeeIqd!,
      paymentMethod: 'cash',
    });
    // 2 × (2,500 + 0 + 500) + (12,000 + 11,000) = 29,000 items; street_30 → zakur fees as previewed.
    expect(order.itemsTotalIqd).toBe(29000);
    expect(order.deliveryFeeIqd).toBe(menu.restaurant.deliveryFeeIqd);
    expect(order.serviceFeeIqd).toBe(menu.restaurant.serviceFeeIqd);
    expect(order.totalIqd).toBe(29000 + menu.restaurant.deliveryFeeIqd! + menu.restaurant.serviceFeeIqd!);
    expect(order.participants).toHaveLength(1);
    expect(order.lines.filter((l) => l.participantId)).toHaveLength(1);
  });
});

describe('launch menus (seed)', () => {
  it('seeds every launch restaurant with sectioned menus in the in-memory twin', async () => {
    const w = await world();
    expect(w.seeded).toHaveLength(AZIZIYAH_RESTAURANTS.length);
    for (const s of w.seeded) {
      const menu = await w.rpc.menu(ACTOR, { merchantId: s.orgId });
      const count = menu.categories.reduce((n, c) => n + c.items.length, 0);
      expect(count, s.seed.key).toBe(s.seed.categories.reduce((n, c) => n + c.items.length, 0));
      expect(menu.categories.map((c) => c.name)).toEqual(s.seed.categories.map((c) => c.nameAr));
    }
  });
});
