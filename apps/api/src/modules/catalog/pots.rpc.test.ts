import { describe, expect, it } from 'vitest';
import { FOLLOW_RULES, isDriverError, type AppContext } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { OrgsService } from '../orgs/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryCatalogRepository } from './catalog.repository.js';
import { CatalogRpc } from './catalog.rpc.js';
import { CatalogService } from './catalog.service.js';
import { seedStorefronts } from './seed.js';

/** Saturday 2026-10-03 13:00 Baghdad: الحاج كريم, الشام and خالد are open; المسافر (5:00–15:00) too. */
const SAT_LUNCH = '2026-10-03T10:00:00Z';
const ME = { personId: 'c1', sessionId: 's1' };

async function world(at = SAT_LUNCH) {
  const clock = new FakeClock(at);
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const rpc = new CatalogRpc(catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(orgs)), new PricingService(new ConfigService()), clock);
  const seeded = await seedStorefronts(orgs, catalog);
  const byKey = (key: string) => seeded.find((s) => s.seed.key === key)!;
  const item = (kitchen: string, dish: string) => byKey(kitchen).itemIds.get(dish)!;
  return { clock, catalog, rpc, byKey, item };
}

function caller(rpc: CatalogRpc, personId: string | null) {
  const ctx = {
    auth: personId ? { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async () => false },
    catalog: rpc,
  } as unknown as AppContext;
  return t.createCallerFactory(appRouter)(ctx).catalog;
}

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return isDriverError(err) ? err.code : String(err);
}

describe('«قدر اليوم» on the customer side (joy h2)', () => {
  it('lists the pots that show now, with the dish at its menu price, open kitchens first — for guests too', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    await w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'rice_bamia'), note: 'ويا لحم غنم', until: '16:00' }, 'owner');
    w.clock.advance(60_000);
    await w.catalog.postPot(w.byKey('musafir').orgId, { itemId: w.item('musafir', 'dolma'), note: null, until: null }, 'owner');
    const pots = await caller(w.rpc, null).pots({ cityId: 'aziziyah' });
    expect(pots.map((p) => [p.restaurantName, p.dish.name])).toEqual([
      ['مشويات الحاج كريم', 'تمن وبامية'],
      ['مطعم المسافر', 'دولمة'],
    ]);
    expect(pots[0]).toMatchObject({ merchantOrgId: kareem, restaurantOpen: true, note: 'ويا لحم غنم', until: '16:00', followed: false, dish: { priceIqd: 5000 } });
  });

  it('a pot past its «لحد» time, from yesterday, or whose dish ran out does not show', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    await w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'rice_bamia'), note: null, until: '14:00' }, 'owner');
    expect(await w.rpc.pots(ME, { cityId: 'aziziyah' })).toHaveLength(1);
    w.clock.set(new Date('2026-10-03T11:00:00Z')); // 14:00
    expect(await w.rpc.pots(ME, { cityId: 'aziziyah' })).toHaveLength(0);

    await w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'rice_bamia'), note: null, until: null }, 'owner');
    await w.catalog.soldOutToday(kareem, w.item('haj_kareem', 'rice_bamia'));
    expect(await w.rpc.pots(ME, { cityId: 'aziziyah' })).toHaveLength(0);

    w.clock.set(new Date('2026-10-04T10:00:00Z')); // the next day: sold out has ended, the pot was yesterday's
    expect(await w.rpc.pots(ME, { cityId: 'aziziyah' })).toHaveLength(0);
  });

  it('posting again the same day replaces the dish; clearing takes it off', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    await w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'rice_bamia'), note: null, until: null }, 'owner');
    await w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'rice_fasoulia'), note: null, until: null }, 'staff');
    expect((await w.rpc.pots(ME, { cityId: 'aziziyah' })).map((p) => p.dish.name)).toEqual(['تمن وفاصوليا']);
    await w.catalog.clearPot(kareem);
    expect(await w.rpc.pots(ME, { cityId: 'aziziyah' })).toEqual([]);
  });

  it('refuses another kitchen’s dish and a dish off sale', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    expect(await code(w.catalog.postPot(kareem, { itemId: w.item('khalid', 'kebab_wrap'), note: null, until: null }, 'owner'))).toBe('menu_item_not_found');
    await w.catalog.setAvailability(kareem, w.item('haj_kareem', 'hummus'), false);
    expect(await code(w.catalog.postPot(kareem, { itemId: w.item('haj_kareem', 'hummus'), note: null, until: null }, 'owner'))).toBe('pot_dish_unavailable');
  });

  it('the restaurant page carries the pot, the followable dishes (30 days) and the story only when shown', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    const fasoulia = w.item('haj_kareem', 'rice_fasoulia');
    await w.catalog.postPot(kareem, { itemId: fasoulia, note: null, until: null }, 'owner');
    w.clock.set(new Date('2026-10-05T10:00:00Z'));
    const bamia = w.item('haj_kareem', 'rice_bamia');
    await w.catalog.postPot(kareem, { itemId: bamia, note: 'ويا لحم غنم', until: null }, 'owner');
    let menu = await w.rpc.menu(ME, { merchantId: kareem });
    expect(menu.pot).toEqual({ itemId: bamia, note: 'ويا لحم غنم', until: null });
    expect([...(menu.potDishes ?? [])].sort()).toEqual([bamia, fasoulia].sort());
    expect(menu.story).toBeNull();

    await w.catalog.setStory(kareem, { text: 'نشوي على الفحم من أيام أبوي.', sinceYear: 1998, shown: false });
    expect((await w.rpc.menu(ME, { merchantId: kareem })).story).toBeNull();
    await w.catalog.setStory(kareem, { text: 'نشوي على الفحم من أيام أبوي.', sinceYear: 1998, shown: true });
    menu = await w.rpc.menu(ME, { merchantId: kareem });
    expect(menu.story).toEqual({ text: 'نشوي على الفحم من أيام أبوي.', sinceYear: 1998 });
    // The story survives the storefront being saved again (hours edited in the demo, the seed re-run).
    const front = (await w.catalog.storefront(kareem))!;
    await w.catalog.saveStorefront({ ...front, hours: [] });
    expect((await w.rpc.menu(ME, { merchantId: kareem })).story?.sinceYear).toBe(1998);

    // Forty days on, the old pots are no longer followable from the item sheet.
    w.clock.set(new Date('2026-11-14T10:00:00Z'));
    menu = await w.rpc.menu(ME, { merchantId: kareem });
    expect(menu.pot).toBeNull();
    expect(menu.potDishes).toEqual([]);
  });

  it('cards carry the pause windows (Friday prayer) for pre-order slots', async () => {
    const w = await world();
    const [card] = await w.rpc.restaurants(ME, { cityId: 'aziziyah', filters: { query: 'خالد' } });
    expect(card?.pauses).toContainEqual({ dow: 5, start: '11:45', end: '13:15' });
  });
});

describe('following a dish (joy h2)', () => {
  it('follows and stops through the router; the pot card says followed', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    const bamia = w.item('haj_kareem', 'rice_bamia');
    const me = caller(w.rpc, 'c1');
    expect(await me.followDish({ merchantOrgId: kareem, itemId: bamia, on: true })).toEqual({ itemIds: [bamia] });
    expect(await me.followDish({ merchantOrgId: kareem, itemId: bamia, on: true })).toEqual({ itemIds: [bamia] });
    await w.catalog.postPot(kareem, { itemId: bamia, note: null, until: null }, 'owner');
    expect((await me.pots({ cityId: 'aziziyah' }))[0]?.followed).toBe(true);
    expect((await caller(w.rpc, 'c2').pots({ cityId: 'aziziyah' }))[0]?.followed).toBe(false);
    expect(await me.dishFollows()).toEqual({ itemIds: [bamia] });
    expect(await me.followDish({ merchantOrgId: kareem, itemId: bamia, on: false })).toEqual({ itemIds: [] });
  });

  it('guests cannot follow', async () => {
    const w = await world();
    await expect(caller(w.rpc, null).followDish({ merchantOrgId: 'x', itemId: 'y', on: true })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a dish of another kitchen and more than the limit; stopping always works', async () => {
    const w = await world();
    const kareem = w.byKey('haj_kareem').orgId;
    expect(await code(w.catalog.followDish('c1', kareem, w.item('khalid', 'kebab_wrap'), true))).toBe('menu_item_not_found');
    const owner = new Map<string, string>();
    for (const k of ['haj_kareem', 'khalid', 'sham']) for (const id of w.byKey(k).itemIds.values()) owner.set(id, w.byKey(k).orgId);
    const ids = [...owner.keys()];
    const orgOf = (id: string) => owner.get(id)!;
    for (const id of ids.slice(0, FOLLOW_RULES.maxPerPerson)) await w.catalog.followDish('c1', orgOf(id), id, true);
    const extra = ids[FOLLOW_RULES.maxPerPerson]!;
    expect(await code(w.catalog.followDish('c1', orgOf(extra), extra, true))).toBe('dish_follow_limit');
    expect(await w.catalog.followDish('c1', orgOf(ids[0]!), ids[0]!, false)).toHaveLength(FOLLOW_RULES.maxPerPerson - 1);
  });
});
