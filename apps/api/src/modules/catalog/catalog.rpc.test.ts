import { describe, expect, it } from 'vitest';
import { CATALOG_PUBLIC_RATE, PriceRequest, isDriverError, type AppContext, type DealBadge, type MenuItem, type RestaurantCard } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { DEMO_SHOPS } from '@driver/contracts/demo-shops';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';
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
import { CARD_CONCURRENCY, CatalogRpc, type StorefrontMerchants } from './catalog.rpc.js';
import { CatalogService } from './catalog.service.js';
import { seedStorefronts } from './seed.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import { UPLOAD_PHOTO_PREFIX } from './photos.js';

/** Saturday 2026-10-03 18:12 Baghdad: the three dinner kitchens are open, المسافر (5:00–15:00) is not. */
const SAT_EVENING = '2026-10-03T15:12:00Z';
const ZAKUR = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
const CENTRE_HOME = { zoneKey: 'centre' };

/** Uses up all but the last of a guest IP's reads in the window, without running 1,200 real reads. */
async function fillGuestWindow(w: Awaited<ReturnType<typeof world>>, ip: string) {
  for (let i = 0; i < CATALOG_PUBLIC_RATE.perIp - 1; i++) await w.guests.hit(`catalog:guest:${ip}`, CATALOG_PUBLIC_RATE.windowMs, CATALOG_PUBLIC_RATE.perIp);
}

async function world(at = SAT_EVENING) {
  const clock = new FakeClock(at);
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository());
  const pricing = new PricingService(new ConfigService());
  const guests = new InMemoryWindowCounter(clock);
  const rpc = new CatalogRpc(catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(orgs)), pricing, clock, guests);
  const seeded = await seedStorefronts(orgs, catalog);
  const byKey = (key: string) => seeded.find((s) => s.seed.key === key)!;
  return { clock, orgs, catalog, pricing, rpc, seeded, byKey, guests };
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
    // Joy o11: the hours travel with the card, for pre-order slots.
    expect(musafir.hours).toHaveLength(7);
    expect(musafir.hours?.[0]).toEqual({ dow: 0, start: '05:00', end: '15:00' });
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

  it('is public for guest browsing: no account needed, same cards as a signed-in reader', async () => {
    const w = await world();
    const guest = await caller(w.rpc, null).restaurants({ cityId: 'aziziyah', dropoff: ZAKUR });
    const signedIn = await caller(w.rpc).restaurants({ cityId: 'aziziyah', dropoff: ZAKUR });
    expect(guest).toEqual(signedIn);
    const menu = await caller(w.rpc, null).menu({ merchantId: w.byKey('khalid').orgId });
    expect(menu.restaurant.name).toBe('مطعم خالد');
  });

  it('limits guests per client IP (rate_limited with retryAfterSec); signed-in readers are not limited', async () => {
    const w = await world();
    const guest = { actor: null, ip: '10.0.0.7' };
    await fillGuestWindow(w, guest.ip);
    await w.rpc.search(guest, { cityId: 'aziziyah', query: 'كباب' }); // the last allowed read
    const err = await w.rpc.restaurants(guest, { cityId: 'aziziyah', filters: {} }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isDriverError(err) && err.code).toBe('rate_limited');
    expect(isDriverError(err) && err.envelope.retryAfterSec).toBeGreaterThan(0);
    // Another guest, and the same IP once signed in, still read.
    await expect(w.rpc.restaurants({ actor: null, ip: '10.0.0.8' }, { cityId: 'aziziyah', filters: {} })).resolves.toHaveLength(4);
    await expect(w.rpc.restaurants({ actor: ACTOR, ip: '10.0.0.7' }, { cityId: 'aziziyah', filters: {} })).resolves.toHaveLength(4);
    // The window slides: a minute later the guest reads again.
    w.clock.advance(CATALOG_PUBLIC_RATE.windowMs + 1);
    await expect(w.rpc.restaurants(guest, { cityId: 'aziziyah', filters: {} })).resolves.toHaveLength(4);
  });
});

describe('catalog.search', () => {
  const search = async (query: string, at?: string) => {
    const w = await world(at);
    return caller(w.rpc, null).search({ cityId: 'aziziyah', query, dropoff: ZAKUR });
  };

  it('finds kitchens by name first, then dishes, with Arabic folding (ة/ه, أ/ا, ى/ي, گ/ك, "ال", Eastern digits)', async () => {
    const byName = await search('خالد');
    expect(byName.restaurants[0]?.name).toBe('مطعم خالد');
    expect(byName.dishes.map((d) => d.name)).toContain('مشكّل خالد');

    // "الشاورما" (with ال and a typed ة/ه mix) finds the shawarma kitchen and its dishes.
    const shawarma = await search('الشاورما');
    expect(shawarma.restaurants.map((r) => r.name)).toEqual(['مأكولات الشام']);
    expect(shawarma.dishes.map((d) => d.name)).toEqual(expect.arrayContaining(['شاورما دجاج', 'شاورما لحم', 'صحن شاورما دجاج']));
    expect(shawarma.dishes.every((d) => d.restaurantName === 'مأكولات الشام' && d.priceIqd > 0)).toBe(true);

    expect((await search('تكه')).dishes.map((d) => d.name)).toEqual(expect.arrayContaining(['لفة تكة', 'وجبة تكة', 'تكة لحم']));
    // گ folds to ك; a menu section matches its dishes ("ريوگ" → the breakfast plates).
    expect((await search('ريوك')).dishes.map((d) => d.name)).toEqual(expect.arrayContaining(['كاهي وقيمر', 'مخلمة']));
    expect((await search('باجه')).dishes.map((d) => d.name)[0]).toBe('باچة');
    expect((await search('جاي عراقى')).dishes.map((d) => d.name)).toEqual(['چاي عراقي']);
    expect((await search('اربيل')).dishes.map((d) => d.name)).toEqual(['لبن أربيل']);
    // Eastern digits fold to Western ("خبز تنور (4 أرغفة)").
    expect((await search('تنور ٤')).dishes.map((d) => d.name)).toEqual(['خبز تنور (4 أرغفة)']);
    // A kitchen that matches only through its dishes is still listed, after the name matches.
    expect((await search('كباب')).restaurants.map((r) => r.name).sort()).toEqual(['مشويات الحاج كريم', 'مطعم خالد'].sort());
  });

  it('keeps closed kitchens reachable: marked with when they open, their dishes after open ones', async () => {
    // Saturday 18:12: المسافر (5:00–15:00) is closed; تمن is on its menu and on الحاج كريم's.
    const r = await search('تمن');
    const musafir = r.restaurants.find((c) => c.name === 'مطعم المسافر');
    expect(musafir).toMatchObject({ open: false, opensAt: '5:00' });
    const fromMusafir = r.dishes.find((d) => d.restaurantName === 'مطعم المسافر');
    expect(fromMusafir).toMatchObject({ restaurantOpen: false, restaurantOpensAt: '5:00' });
    expect(r.dishes[0]?.restaurantOpen).toBe(true);
    const firstClosed = r.dishes.findIndex((d) => !d.restaurantOpen);
    expect(r.dishes.slice(firstClosed).every((d) => !d.restaurantOpen)).toBe(true);
  });

  it('says nothing found plainly (empty lists), and folds punctuation-only queries to nothing', async () => {
    expect(await search('بيتزا')).toMatchObject({ folded: 'بيتزا', restaurants: [], dishes: [] });
    expect(await search('؟!')).toEqual({ folded: '', restaurants: [], dishes: [] });
  });

  it('every query word has to match (narrowing)', async () => {
    const r = await search('شاورما لحم');
    expect(r.dishes.map((d) => d.name)).toEqual(['شاورما لحم']);
  });
});

describe('catalog.carryOver (joy o15: a rejection that explains)', () => {
  it('suggests the other grill kitchen first and says how much of the cart it makes and about what it costs', async () => {
    const w = await world();
    const khalid = w.byKey('khalid');
    const preview = await caller(w.rpc).carryOver({
      cityId: 'aziziyah',
      merchantId: khalid.orgId,
      dropoff: ZAKUR,
      lines: [
        { name: 'كباب بالكيلو', qty: 1, choices: ['نص كيلو'] },
        { name: 'لفة تكة', qty: 2, choices: ['صمون حجري'] },
      ],
    });
    expect(preview.options.length).toBeGreaterThan(0);
    const haj = preview.options[0]!;
    expect(haj.restaurant.name).toBe('مشويات الحاج كريم');
    expect(haj.of).toBe(2);
    expect(haj.moved + haj.missing.length).toBe(2);
    expect(preview.options.map((o) => o.restaurant.id)).not.toContain(khalid.orgId);
    if (haj.moved > 0) {
      expect(haj.totalIqd! % 250).toBe(0);
      expect(haj.totalIqd!).toBeGreaterThan((haj.restaurant.deliveryFeeIqd ?? 0) + (haj.restaurant.serviceFeeIqd ?? 0));
    }
  });

  it('without a deliver-to point there is no total, only what carries over', async () => {
    const w = await world();
    const preview = await caller(w.rpc, null).carryOver({ cityId: 'aziziyah', merchantId: w.byKey('khalid').orgId, lines: [{ name: 'شوربة عدس', qty: 1, choices: [] }] });
    for (const o of preview.options) expect(o.totalIqd).toBeNull();
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

  it('says how many a dish or its version feeds and carries the kitchen’s labels (joy o3, o8)', async () => {
    const w = await world();
    const menu = await caller(w.rpc).menu({ merchantId: w.byKey('khalid').orgId });
    const items = menu.categories.flatMap((c) => c.items);
    const byName = (n: string) => items.find((i) => i.name === n)!;
    expect(byName('كباب بالكيلو').modifierGroups[0]!.modifiers.map((m) => [m.name, m.serves])).toEqual([
      ['نص كيلو', { min: 2, max: 3 }],
      ['كيلو', { min: 4, max: 5 }],
    ]);
    expect(byName('مشكّل خالد')).toMatchObject({ serves: { min: 2, max: 2 }, labels: ['family'] });
    expect(byName('لفة كباب')).toMatchObject({ serves: null, labels: [] });
  });

  it('a kitchen’s «يشبّع» typed high to low is refused', async () => {
    const w = await world();
    const khalid = w.byKey('khalid');
    await expect(
      w.catalog.setModifiers(khalid.orgId, khalid.itemIds.get('kebab_kilo')!, [{ nameAr: 'الكمية', required: true, minSelect: 1, maxSelect: 1, modifiers: [{ nameAr: 'كيلو', priceIqd: 0, servesMin: 5, servesMax: 4 }] }]),
    ).rejects.toMatchObject({ code: 'invalid_input' });
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

describe('catalog.today (welcome screen live proof, audit d-6)', () => {
  it('a guest reads open kitchens, a centre tuktuk fare, the late promise — and the الرجعة facts when bound', async () => {
    const w = await world();
    const bare = await caller(w.rpc, null).today({ cityId: 'aziziyah' });
    // Saturday evening: three of the four launch kitchens are open (المسافر closes at 15:00).
    expect(bare).toMatchObject({ openRestaurants: 3, rajaaCarsToday: 0, baghdadGarage: null, latePromiseMin: 20 });
    // The same engine a booking uses: tuktuk inside the centre at the city's fares.
    const quote = w.pricing.quote(PriceRequest.parse({ cityId: 'aziziyah', vertical: 'tuktuk', stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'centre', type: 'dropoff' }], at: w.clock.now() }));
    expect(bare.tuktukFromIqd).toBe(quote.total);
    expect(bare.tuktukFromIqd).toBeGreaterThan(0);

    const bound = new CatalogRpc(w.catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(w.orgs)), w.pricing, w.clock, undefined, undefined, {
      rajaa: async () => ({ carsToday: 6, baghdadGarage: { id: 'mp_garage_bab1', nameAr: 'كراج البوابة 1', nameEn: 'Gate 1 garage' } }),
      latePromiseMin: () => 25,
    });
    expect(await bound.today(ACTOR, { cityId: 'aziziyah' })).toMatchObject({
      rajaaCarsToday: 6,
      baghdadGarage: { id: 'mp_garage_bab1', name_ar: 'كراج البوابة 1', name_en: 'Gate 1 garage' },
      latePromiseMin: 25,
    });
  });

  it('is rate-limited for guests like the rest of the public catalog', async () => {
    const w = await world();
    const guest = { actor: null, ip: '10.0.0.9' };
    await fillGuestWindow(w, guest.ip);
    await w.rpc.today(guest, { cityId: 'aziziyah' }); // the last allowed read
    const err = await w.rpc.today(guest, { cityId: 'aziziyah' }).catch((e: unknown) => e);
    expect(isDriverError(err) && err.code).toBe('rate_limited');
  });
});

describe('menu deal prices, the small-order fee and the first to open (J1d: f10, J-D6, f12)', () => {
  const badge = (over: Partial<DealBadge> = {}): DealBadge => ({
    dealId: 'deal_20',
    type: 'percent',
    value: 20,
    minOrderIqd: 0,
    itemIds: [],
    label_ar: 'خصم 20% على كل المنيو',
    label_en: '20% off the whole menu',
    endsAt: new Date('2026-10-10T00:00:00Z'),
    ...over,
  });

  async function withDeals(deals: DealBadge[]) {
    const w = await world();
    const base = new OrdersStorefrontMerchants(new OrgsMerchantDirectory(w.orgs));
    const merchants = { timeZone: base.timeZone, profile: base.profile.bind(base), deals: async () => deals };
    return { w, rpc: new CatalogRpc(w.catalog, merchants, w.pricing, w.clock) };
  }

  it('a 20 % all-menu deal gives every dish its deal price, the same rule orders.quote applies', async () => {
    const { w, rpc } = await withDeals([badge()]);
    const menu = await caller(rpc).menu({ merchantId: w.byKey('khalid').orgId });
    const items = menu.categories.flatMap((c) => c.items);
    const wrap = items.find((i) => i.name === 'لفة كباب')!;
    expect(wrap.deal).toEqual({ dealId: 'deal_20', percent: 20, priceIqd: 1_600 });
    for (const i of items) expect(i.deal?.priceIqd, i.name).toBe(i.priceIqd - Math.floor((i.priceIqd * 20) / 100));
  });

  it('a deal with a minimum or on other dishes leaves the menu price alone', async () => {
    const { w, rpc } = await withDeals([badge({ minOrderIqd: 15_000 }), badge({ dealId: 'scoped', itemIds: ['nothing-here'] })]);
    const menu = await caller(rpc).menu({ merchantId: w.byKey('khalid').orgId });
    for (const i of menu.categories.flatMap((c) => c.items)) expect(i.deal ?? null, i.name).toBeNull();
  });

  it('the card carries the small-order fee below its minimum and minutes to opening when closed', async () => {
    const w = await world();
    const cards = await caller(w.rpc).restaurants({ cityId: 'aziziyah', dropoff: ZAKUR });
    const khalid = cards.find((c) => c.name === 'مطعم خالد')!;
    expect(khalid).toMatchObject({ minOrderIqd: 5_000, smallOrderFeeIqd: 500, opensInMin: null });
    // Saturday 18:12 → Sunday 05:00: 10 h 48 min.
    expect(cards.find((c) => c.name === 'مطعم المسافر')).toMatchObject({ open: false, opensAt: '5:00', opensInMin: 648 });
  });
});

describe('catalog.picks (joy h1 daypart band, h4 meal words)', () => {
  it('returns only dishes from kitchens open now, earlier words first, one per kitchen before a second', async () => {
    const w = await world(); // Saturday evening: المسافر (باچة) is closed
    const picks = await caller(w.rpc, null).picks({ cityId: 'aziziyah', words: ['باچة', 'كباب', 'شاورما', 'تكة'], limit: 3 });
    expect(picks).toHaveLength(3);
    expect(picks.every((d) => d.restaurantOpen && d.available)).toBe(true);
    expect(picks.some((d) => d.name.includes('باچة'))).toBe(false);
    // Three different kitchens before any second dish from one of them.
    expect(new Set(picks.map((d) => d.restaurantId)).size).toBe(3);
  });

  it('at dawn the breakfast kitchen answers with its real dishes; a word nobody cooks adds nothing', async () => {
    const w = await world('2026-10-03T04:30:00Z'); // 7:30 Baghdad: only المسافر is open
    const picks = await w.rpc.picks(ACTOR, { cityId: 'aziziyah', words: ['بيتزا', 'باچة', 'كاهي'], limit: 3 });
    expect(picks).toHaveLength(3);
    expect(picks.every((d) => d.restaurantName === 'مطعم المسافر')).toBe(true);
    // The dish itself before a dish that only carries its name, then another word before a second باچة.
    expect(picks.map((d) => d.name)).toEqual(['باچة', 'كاهي وقيمر', 'تشريب باچة']);
  });

  it('is empty when nothing open matches', async () => {
    const w = await world();
    expect(await w.rpc.picks(ACTOR, { cityId: 'aziziyah', words: ['بيتزا'], limit: 3 })).toEqual([]);
  });

  it('says which dishes a card can add in one tap: none of their option groups asks for a choice', async () => {
    const w = await world();
    const khalid = w.byKey('khalid');
    const picks = await w.rpc.picks(ACTOR, { cityId: 'aziziyah', words: ['كباب', 'كبد'], limit: 12 });
    // «كباب بالكيلو» asks half a kilo or a kilo; «وجبة كبد» has nothing to choose.
    expect(picks.find((d) => d.id === khalid.itemIds.get('kebab_kilo'))).toMatchObject({ quickAdd: false });
    expect(picks.find((d) => d.id === khalid.itemIds.get('liver_plate'))).toMatchObject({ quickAdd: true });
    const found = await w.rpc.search(ACTOR, { cityId: 'aziziyah', query: 'كباب بالكيلو' });
    expect(found.dishes.find((d) => d.id === khalid.itemIds.get('kebab_kilo'))).toMatchObject({ quickAdd: false });
  });
});

describe('catalog.cravings (food doors: «شنو بخاطرك؟», d5/k9/s6/j2)', () => {
  async function shopsWorld() {
    const w = await world();
    await seedStorefronts(w.orgs, w.catalog, DEMO_SHOPS);
    return w;
  }

  it('answers each kind with the open shops that have it, one dish per shop, and drops kinds nobody has', async () => {
    const w = await shopsWorld();
    const out = await caller(w.rpc, null).cravings({
      cityId: 'aziziyah',
      kinds: [
        { key: 'kunafa', words: ['كنافة'] },
        { key: 'pizza', words: ['بيتزا'] },
        { key: 'icecream', words: ['آيس كريم', 'كون', 'كوب آيس'] },
      ],
    });
    expect(out.map((k) => k.key)).toEqual(['kunafa', 'icecream']);
    const kunafa = out[0]!;
    // Two kunafas at الزهراء, one dish for the shop: the plain name before «بالقيمر», then the cheaper.
    expect(kunafa.dishes).toHaveLength(1);
    expect(kunafa.dishes[0]).toMatchObject({ name: 'كنافة نابلسية', restaurantName: 'حلويات الزهراء', restaurantOpen: true });
    // Both ice cream shops have it.
    expect(new Set(out[1]!.dishes.map((d) => d.restaurantName))).toEqual(new Set(['حلويات الزهراء', 'آيس كريم الفرات']));
  });

  it('gives a sweet sold by weight its kilo price; a dish sold by the piece has none', async () => {
    const w = await shopsWorld();
    const [baklava, cake] = await w.rpc.cravings(ACTOR, {
      cityId: 'aziziyah',
      kinds: [
        { key: 'baklava', words: ['بقلاوة'] },
        { key: 'cake', words: ['كيك'] },
      ],
    });
    // Quarter 5,000 + the kilo option 15,000.
    expect(baklava?.dishes[0]).toMatchObject({ name: 'بقلاوة', priceIqd: 5000, kiloIqd: 20000 });
    expect(cake?.dishes[0]?.kiloIqd).toBeNull();
  });

  it('k7: an ice-cream-only shop drops out past 3 km by road; a sweets shop that also sells ice cream stays', async () => {
    const w = await shopsWorld();
    const kinds = [{ key: 'icecream', words: ['آيس كريم', 'كون', 'كوب آيس'] }];
    const shopsAt = async (dropoff: { zoneKey: string; pin: { lat: number; lng: number } }) => ({
      list: (await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff, filters: {} })).map((c) => c.name),
      cravings: new Set((await w.rpc.cravings(ACTOR, { cityId: 'aziziyah', kinds, dropoff }))[0]?.dishes.map((d) => d.restaurantName)),
    });
    // الفرات is in the centre: about 0.6 km away it delivers; زاكور is about 3.3 km by road.
    const near = await shopsAt({ zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 } });
    expect(near.list).toContain('آيس كريم الفرات');
    expect(near.cravings).toEqual(new Set(['حلويات الزهراء', 'آيس كريم الفرات']));
    const far = await shopsAt(ZAKUR);
    expect(far.list).not.toContain('آيس كريم الفرات');
    expect(far.list).toContain('حلويات الزهراء');
    expect(far.cravings).toEqual(new Set(['حلويات الزهراء']));
  });

  it('leaves closed shops out', async () => {
    const w = await world('2026-10-03T05:00:00Z'); // 8:00 Baghdad: الفرات opens at 12
    await seedStorefronts(w.orgs, w.catalog, DEMO_SHOPS);
    const out = await w.rpc.cravings(ACTOR, { cityId: 'aziziyah', kinds: [{ key: 'cone', words: ['كون'] }] });
    expect(out).toEqual([]);
  });
});

describe('cards built side by side (perf t4)', () => {
  it("answers exactly what one-by-one building answers, in the storefronts' order, however slowly each kitchen replies", async () => {
    const clock = new FakeClock(SAT_EVENING);
    const orgs = new OrgsService(undefined, clock);
    const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
    const pricing = new PricingService(new ConfigService());
    const plain = new OrdersStorefrontMerchants(new OrgsMerchantDirectory(orgs));
    await seedStorefronts(orgs, catalog);
    await seedStorefronts(orgs, catalog, DEMO_SHOPS);
    const fronts = await catalog.storefronts('aziziyah');
    expect(fronts.length).toBeGreaterThan(CARD_CONCURRENCY);
    // Every kitchen posts a pot at the same instant: equal times keep the storefronts' order, so the
    // answer shows whether cards that finished out of order were put back in place.
    for (const f of fronts) {
      const dish = (await catalog.menu(f.orgId)).find((i) => i.available);
      if (dish) await catalog.postPot(f.orgId, { itemId: dish.id, note: null, until: null }, 'owner');
    }
    // The first kitchens in the list answer last: built in parallel, they finish in reverse.
    const delayOf = new Map(fronts.map((f, i) => [f.orgId, (fronts.length - i) * 3]));
    let running = 0;
    let peak = 0;
    const slow: StorefrontMerchants = {
      timeZone: plain.timeZone,
      async profile(orgId, cityId, at) {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, delayOf.get(orgId) ?? 0));
        running -= 1;
        return plain.profile(orgId, cityId, at);
      },
    };
    const oneByOne = new CatalogRpc(catalog, plain, pricing, clock);
    const parallel = new CatalogRpc(catalog, slow, pricing, clock);
    const read = async (rpc: CatalogRpc) => ({
      restaurants: await rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: ZAKUR, filters: {} }),
      picks: await rpc.picks(ACTOR, { cityId: 'aziziyah', words: ['كباب', 'كنافة', 'تكة'], limit: 6, dropoff: ZAKUR }),
      search: await rpc.search(ACTOR, { cityId: 'aziziyah', query: 'كباب', dropoff: ZAKUR }),
      pots: await rpc.pots(ACTOR, { cityId: 'aziziyah', dropoff: ZAKUR }),
    });
    const one = await read(oneByOne);
    const both = await read(parallel);
    expect(both).toEqual(one);
    // Open kitchens' pots first, each group in the storefronts' own order.
    const order = new Map(fronts.map((f, i) => [f.orgId, i]));
    const open = one.pots.filter((p) => p.restaurantOpen).map((p) => order.get(p.merchantOrgId)!);
    expect(open.length).toBeGreaterThanOrEqual(CARD_CONCURRENCY);
    expect(open).toEqual([...open].sort((a, b) => a - b));
    // Bounded: several kitchens at once, never more than the limit.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(CARD_CONCURRENCY);
  });
});

describe('search.unmet (joy h4: what the town asks for that nobody serves yet)', () => {
  function searchCaller(rpc: CatalogRpc, personId: string | null, staff = false) {
    const ctx = {
      auth: personId ? { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 } : null,
      authError: null,
      identity: { hasRole: async () => staff },
      catalog: rpc,
      client: { ip: '10.0.0.7' },
    } as unknown as AppContext;
    return t.createCallerFactory(appRouter)(ctx).search;
  }

  it('keeps the words anonymously (guests too) and the Console reads them grouped by the folded term', async () => {
    const w = await world();
    await searchCaller(w.rpc, null).unmet({ cityId: 'aziziyah', term: 'بيتزا', zoneKey: 'street_30' });
    w.clock.advance(60_000);
    await searchCaller(w.rpc, 'c1').unmet({ cityId: 'aziziyah', term: 'البيتزا', zoneKey: 'street_30' });
    await searchCaller(w.rpc, 'c2').unmet({ cityId: 'aziziyah', term: 'سوشي' });
    const rows = await searchCaller(w.rpc, 'ops', true).unmetList({ cityId: 'aziziyah' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ term: 'بيتزا', typed: 'البيتزا', searches: 2, signedIn: 1, zones: [{ zoneKey: 'street_30', searches: 2 }] });
    expect(rows[1]).toMatchObject({ term: 'سوشي', searches: 1, zones: [{ zoneKey: null, searches: 1 }] });
    expect(JSON.stringify(rows)).not.toContain('c1');
  });

  it('only Console desks read the list; one caller cannot flood it', async () => {
    const w = await world();
    await expect(searchCaller(w.rpc, 'c1').unmetList({ cityId: 'aziziyah' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (let i = 0; i < 10; i++) await w.rpc.unmet(ACTOR, { cityId: 'aziziyah', term: `كلمة ${i}`, zoneKey: null });
    const err = await w.rpc.unmet(ACTOR, { cityId: 'aziziyah', term: 'زيادة', zoneKey: null }).catch((e: unknown) => e);
    expect(isDriverError(err) && err.code).toBe('rate_limited');
  });

  it('forgets nothing inside the window and drops what is older than it', async () => {
    const w = await world();
    await w.rpc.unmet(ACTOR, { cityId: 'aziziyah', term: 'برگر', zoneKey: null });
    w.clock.advance(31 * 86_400_000);
    expect(await w.rpc.unmetSearches(ACTOR, { cityId: 'aziziyah', days: 30, limit: 30 })).toEqual([]);
    expect(await w.rpc.unmetSearches(ACTOR, { cityId: 'aziziyah', days: 60, limit: 30 })).toHaveLength(1);
  });
});

describe('merchant-uploaded dish photos reach customers as working links', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  /** A stored upload, as the item editor or a field ops shoot makes it (ticket + PUT). */
  async function upload(blobs: BlobStore, ownerId: string): Promise<string> {
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/png', sizeBytes: PNG.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/png', bytes: PNG });
    return ticket.uploadId;
  }

  /** The link loads: it is the blob store's own signed read URL for those bytes. */
  async function loads(blobs: BlobStore, link: string | null): Promise<boolean> {
    if (!link) return false;
    const url = new URL(link, 'http://local');
    const id = url.pathname.split('/').pop();
    if (!id) return false;
    const file = await blobs.read({ id, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined });
    return file !== null && file.bytes.equals(PNG);
  }

  async function photoWorld(opts: { signer: boolean }) {
    const w = await world();
    const blobs = new DevBlobStore(w.clock, { secret: 'blob' });
    const rpc = new CatalogRpc(w.catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(w.orgs)), w.pricing, w.clock, undefined, undefined, null, opts.signer ? blobs : null);
    const khalid = w.byKey('khalid');
    const itemId = `${khalid.orgId}_liver_plate`;
    const uploadId = await upload(blobs, 'owner_khalid');
    // Exactly what the owner's «غيّر الصورة» (merchantAdmin.menu.replacePhoto) and an accepted menu-photo-service shot write.
    await w.catalog.replacePhoto(khalid.orgId, itemId, `${UPLOAD_PHOTO_PREFIX}${uploadId}`);
    return { ...w, rpc, blobs, khalid, itemId, uploadId };
  }

  it('on the menu, in search and in meal picks — never the raw `upload:` ref', async () => {
    const w = await photoWorld({ signer: true });
    const c = caller(w.rpc, null);
    const dish = (await c.menu({ merchantId: w.khalid.orgId, dropoff: ZAKUR })).categories.flatMap((x) => x.items).find((i) => i.id === w.itemId);
    expect(dish?.photoUrl).toContain(`/files/${w.uploadId}?`);
    expect(await loads(w.blobs, dish?.photoUrl ?? null)).toBe(true);

    const found = (await c.search({ cityId: 'aziziyah', query: 'كبد', dropoff: ZAKUR })).dishes.find((d) => d.id === w.itemId);
    expect(await loads(w.blobs, found?.photoUrl ?? null)).toBe(true);

    const picked = (await c.picks({ cityId: 'aziziyah', words: ['كبد'], limit: 6 })).find((d) => d.id === w.itemId);
    expect(await loads(w.blobs, picked?.photoUrl ?? null)).toBe(true);

    expect(JSON.stringify(await c.menu({ merchantId: w.khalid.orgId }))).not.toContain(UPLOAD_PHOTO_PREFIX);
  });

  it('a kitchen photo stored as an upload is signed on the card too; plain URLs pass untouched', async () => {
    const w = await photoWorld({ signer: true });
    const front = await w.catalog.storefront(w.khalid.orgId);
    if (!front) throw new Error('no storefront');
    const kitchen = await upload(w.blobs, 'owner_khalid');
    await w.catalog.saveStorefront({ ...front, photoUrl: `${UPLOAD_PHOTO_PREFIX}${kitchen}` });
    await w.catalog.replacePhoto(w.khalid.orgId, `${w.khalid.orgId}_salad`, 'https://cdn.example/salad.jpg');
    const menu = await caller(w.rpc, null).menu({ merchantId: w.khalid.orgId });
    expect(await loads(w.blobs, menu.restaurant.photoUrl)).toBe(true);
    expect(menu.categories.flatMap((x) => x.items).find((i) => i.id === `${w.khalid.orgId}_salad`)?.photoUrl).toBe('https://cdn.example/salad.jpg');
  });

  it('with no blob store to sign with, the upload is left out (the app draws the dish) rather than sent raw', async () => {
    const w = await photoWorld({ signer: false });
    const dish = (await caller(w.rpc, null).menu({ merchantId: w.khalid.orgId })).categories.flatMap((x) => x.items).find((i) => i.id === w.itemId);
    expect(dish?.photoUrl).toBeNull();
  });
});

describe('kill switches on the cards (REL-16)', () => {
  it('a kitchen a switch stopped looks closed, with the switch words, for that door only', async () => {
    const w = await world();
    const kareemId = (await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', filters: { query: 'كريم' } }))[0]!.id;
    const asked: unknown[] = [];
    const switches = {
      stopped: async (input: { cityId: string; merchantOrgId: string; kitchenZone: string | null; dropoffZone: string | null }) => {
        asked.push(input);
        return input.merchantOrgId === kareemId && input.dropoffZone === 'zakur' ? 'مشويات الحاج كريم موقفة هسه' : null;
      },
    };
    const rpc = new CatalogRpc(w.catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(w.orgs)), w.pricing, w.clock, undefined, undefined, null, null, switches);
    const cards = await rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: ZAKUR, filters: {} });
    const kareem = cards.find((c) => c.id === kareemId)!;
    expect(kareem).toMatchObject({ open: false, closedReason: 'paused', stoppedNote: 'مشويات الحاج كريم موقفة هسه', opensInMin: null });
    expect(asked).toContainEqual({ cityId: 'aziziyah', merchantOrgId: kareemId, kitchenZone: 'centre', dropoffZone: 'zakur' });
    for (const c of cards.filter((x) => x.id !== kareemId && x.name !== 'مطعم المسافر')) {
      expect(c.open, c.name).toBe(true);
      expect(c).not.toHaveProperty('stoppedNote');
    }
    // Another door the switch does not cover sees it open.
    const elsewhere = await rpc.restaurants(ACTOR, { cityId: 'aziziyah', dropoff: CENTRE_HOME, filters: {} });
    expect(elsewhere.find((c) => c.id === kareemId)?.open).toBe(true);
  });
});
