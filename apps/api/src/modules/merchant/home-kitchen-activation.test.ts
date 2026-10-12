import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { OrgsService } from '../orgs/index.js';
import { HomeKitchenActivation, activateHomeKitchen } from './home-kitchen-activation.js';
import type { MerchantEventsPort, MerchantOrdersPort, MerchantPeoplePort } from './merchant.service.js';
import { MerchantSetupService, setupCatalogOf } from './setup.service.js';

/**
 * أكل بيت activation over a real in-memory catalog and orgs: `kitchen` is a cook's org as
 * `ops.homeKitchenApply` leaves it (a restaurant org with no storefront), `shop` an ordinary restaurant.
 */
async function harness() {
  const clock = new FakeClock('2026-10-11T09:00:00Z');
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const port = setupCatalogOf(catalog);
  const kitchen = await orgs.create({ type: 'restaurant', name: 'مطبخ أم حسين', cityId: 'aziziyah', ownerId: 'cook' });
  const shop = await orgs.create({ type: 'restaurant', name: 'كباب الزهراء', cityId: 'aziziyah', ownerId: 'o1' });
  const ev = createInMemoryEvents({ clock });
  return { clock, orgs, catalog, port, kitchen, shop, ev };
}

/** «جهّز محلك» started the way the Merchant app starts it on the owner's first read. */
function setupService(h: Awaited<ReturnType<typeof harness>>) {
  const people: MerchantPeoplePort = { grants: async () => [], hasRole: async () => true, courierFirstName: async () => null, courierVehicle: async () => null };
  const events: MerchantEventsPort = { record: async () => undefined };
  const orders: MerchantOrdersPort = { listActive: async () => [], deliveredByDropoffZone: async () => [] };
  return new MerchantSetupService(h.orgs, people, h.port, orders, events, h.clock);
}

describe('activateHomeKitchen', () => {
  it("makes one hidden home storefront named after the kitchen, on the home tier, and says 'made'", async () => {
    const h = await harness();
    expect(await activateHomeKitchen(h.orgs, h.port, h.kitchen.id)).toBe('made');
    const front = await h.catalog.storefront(h.kitchen.id);
    expect(front).toMatchObject({ orgId: h.kitchen.id, cityId: 'aziziyah', nameAr: 'مطبخ أم حسين', cuisineAr: 'أكل بيت', home: { monogram: null } });
    expect((await h.orgs.merchantSettings(h.kitchen.id)).commissionTier).toBe('home');
    expect((await h.orgs.merchantSettings(h.kitchen.id)).setup ?? null).toBeNull();
  });

  it("a second run says 'already' and changes nothing", async () => {
    const h = await harness();
    await activateHomeKitchen(h.orgs, h.port, h.kitchen.id);
    const front = await h.catalog.storefront(h.kitchen.id);
    const settings = await h.orgs.merchantSettings(h.kitchen.id);
    expect(await activateHomeKitchen(h.orgs, h.port, h.kitchen.id)).toBe('already');
    expect(await h.catalog.storefront(h.kitchen.id)).toEqual(front);
    expect(await h.orgs.merchantSettings(h.kitchen.id)).toEqual(settings);
  });

  it('keeps an existing storefront and only marks it home', async () => {
    const h = await harness();
    await h.catalog.saveStorefront({ orgId: h.kitchen.id, cityId: 'aziziyah', nameAr: 'مطبخ أم حسين', cuisineAr: 'دولمة', tags: ['home'], photoUrl: null, minOrderIqd: 5000, hours: [] });
    expect(await activateHomeKitchen(h.orgs, h.port, h.kitchen.id)).toBe('made');
    expect(await h.catalog.storefront(h.kitchen.id)).toMatchObject({ cuisineAr: 'دولمة', minOrderIqd: 5000, home: { monogram: null } });
  });

  it('clears an unfinished «جهّز محلك» and the shutter it closed', async () => {
    const h = await harness();
    const setup = setupService(h);
    await setup.adopt(h.kitchen);
    const before = await h.orgs.merchantSettings(h.kitchen.id);
    expect(before.setup).toMatchObject({ closedBySetup: true });
    expect(before.closed).not.toBeNull();
    expect(await activateHomeKitchen(h.orgs, h.port, h.kitchen.id)).toBe('made');
    const after = await h.orgs.merchantSettings(h.kitchen.id);
    expect(after.setup ?? null).toBeNull();
    expect(after.closed ?? null).toBeNull();
    expect(after.commissionTier).toBe('home');
  });

  it('leaves a shutter the cook closed herself (not by setup) closed', async () => {
    const h = await harness();
    const closed = { reason: 'other' as const, note: 'مسافرة', at: h.clock.now(), until: null };
    await h.orgs.setMerchantSettings(h.kitchen.id, { closed });
    await setupService(h).adopt(h.kitchen);
    expect((await h.orgs.merchantSettings(h.kitchen.id)).setup).toMatchObject({ closedBySetup: false });
    await activateHomeKitchen(h.orgs, h.port, h.kitchen.id);
    const after = await h.orgs.merchantSettings(h.kitchen.id);
    expect(after.setup ?? null).toBeNull();
    expect(after.closed).toMatchObject({ note: 'مسافرة' });
  });
});

describe('HomeKitchenActivation (merchant.activated)', () => {
  const emit = (h: Awaited<ReturnType<typeof harness>>, payload: Record<string, unknown>, key: string) =>
    h.ev.events.emit(undefined, { actorId: 'staff', type: 'merchant.activated', occurredAt: h.clock.now(), payload, idempotencyKey: key }, { name: 'org', id: String(payload['merchantOrgId']) });

  it('a home kitchen approval makes its storefront; a duplicate delivery makes nothing new', async () => {
    const h = await harness();
    const sub = new HomeKitchenActivation(h.ev.events, h.orgs, h.port);
    sub.onModuleInit();
    const payload = { onboardingId: 'onb_1', merchantOrgId: h.kitchen.id, cityId: 'aziziyah', contactPersonId: 'cook', type: 'home_kitchen', reason: null };
    await emit(h, payload, 'a1');
    await h.ev.events.drain();
    const front = await h.catalog.storefront(h.kitchen.id);
    expect(front).toMatchObject({ home: { monogram: null }, cuisineAr: 'أكل بيت' });
    expect((await h.orgs.merchantSettings(h.kitchen.id)).commissionTier).toBe('home');
    const settings = await h.orgs.merchantSettings(h.kitchen.id);
    // The same approval delivered again (a second event, not a replay of the first).
    await emit(h, payload, 'a2');
    await h.ev.events.drain();
    expect(await h.catalog.storefront(h.kitchen.id)).toEqual(front);
    expect(await h.orgs.merchantSettings(h.kitchen.id)).toEqual(settings);
    sub.onModuleDestroy();
  });

  it('ignores a restaurant activation and one with no type: its shop is left to «جهّز محلك»', async () => {
    const h = await harness();
    const sub = new HomeKitchenActivation(h.ev.events, h.orgs, h.port);
    sub.onModuleInit();
    const tierBefore = (await h.orgs.merchantSettings(h.shop.id)).commissionTier;
    await emit(h, { onboardingId: 'onb_2', merchantOrgId: h.shop.id, cityId: 'aziziyah', contactPersonId: 'o1', type: 'restaurant', reason: null }, 'r1');
    await emit(h, { onboardingId: 'onb_3', merchantOrgId: h.shop.id, cityId: 'aziziyah', contactPersonId: 'o1', reason: null }, 'r2');
    await h.ev.events.drain();
    expect(await h.catalog.storefront(h.shop.id)).toBeNull();
    expect((await h.orgs.merchantSettings(h.shop.id)).commissionTier).toBe(tierBefore);
    sub.onModuleDestroy();
  });
});
