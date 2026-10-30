import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { DEMO_HOME_KITCHENS } from '@driver/contracts/demo-home-kitchens';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { OrgsService } from '../orgs/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryCatalogRepository } from './catalog.repository.js';
import { CatalogRpc, type StorefrontHome } from './catalog.rpc.js';
import { CatalogService } from './catalog.service.js';
import { seedStorefronts } from './seed.js';

/** Saturday 2026-10-03 18:12 Baghdad: the dinner kitchens and the demo home kitchens are open. */
const SAT_EVENING = '2026-10-03T15:12:00Z';
const ACTOR = { personId: 'c1', sessionId: 's1' };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** The launch restaurants plus the four demo home kitchens, with the city switch (`homeKitchens.launched`) settable. */
async function world(opts: { bind?: boolean } = {}) {
  const clock = new FakeClock(SAT_EVENING);
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository());
  const switchOn = { aziziyah: false } as Record<string, boolean>;
  const home: StorefrontHome = { open: (cityId) => switchOn[cityId] === true };
  const rpc = new CatalogRpc(catalog, new OrdersStorefrontMerchants(new OrgsMerchantDirectory(orgs)), new PricingService(new ConfigService()), clock, undefined, undefined, null, null, null, opts.bind === false ? null : home);
  const restaurants = await seedStorefronts(orgs, catalog, AZIZIYAH_RESTAURANTS, 'seed-owner', clock.now());
  const kitchens = await seedStorefronts(orgs, catalog, DEMO_HOME_KITCHENS, 'seed-owner', clock.now());
  const byKey = (key: string) => [...restaurants, ...kitchens].find((s) => s.seed.key === key)!;
  return { clock, catalog, rpc, switchOn, restaurants, kitchens, byKey };
}

describe('أكل بيت in the customer catalog (city switch homeKitchens.launched)', () => {
  it('switch off: no kitchens, open false, and a reservation week reads as not found', async () => {
    const w = await world();
    expect(await w.rpc.homeKitchens(ACTOR, { cityId: 'aziziyah' })).toEqual({ open: false, kitchens: [] });
    const um = w.byKey('um_hussein');
    const biryani = (await w.catalog.menu(um.orgId)).find((i) => i.homeSale?.mode === 'reserve')!;
    expect(await code(w.rpc.homeSlots(ACTOR, { merchantId: um.orgId, itemId: biryani.id }))).toBe('org_not_found');
  });

  it('unbound (no switch at all) reads as closed', async () => {
    const w = await world({ bind: false });
    expect(await w.rpc.homeKitchens(ACTOR, { cityId: 'aziziyah' })).toEqual({ open: false, kitchens: [] });
  });

  it('switch on: the city kitchens, with their letter and ready/reservation counts; another city stays closed', async () => {
    const w = await world();
    w.switchOn['aziziyah'] = true;
    const r = await w.rpc.homeKitchens(ACTOR, { cityId: 'aziziyah' });
    expect(r.open).toBe(true);
    expect(r.kitchens.map((k) => k.id).sort()).toEqual(w.kitchens.map((k) => k.orgId).sort());
    const um = r.kitchens.find((k) => k.id === w.byKey('um_hussein').orgId)!;
    // «مطبخ أم حسين» with no letter of her own → «ح»; dolma and kubba ready, quzi and biryani by reservation.
    expect(um.home).toEqual({ monogram: 'ح', readyCount: 2, reserveCount: 2 });
    expect(await w.rpc.homeKitchens(ACTOR, { cityId: 'kut' })).toEqual({ open: false, kitchens: [] });
  });

  it('home kitchens never show in the restaurant list, switch on or off', async () => {
    const w = await world();
    const homeIds = new Set(w.kitchens.map((k) => k.orgId));
    for (const on of [false, true]) {
      w.switchOn['aziziyah'] = on;
      const cards = await w.rpc.restaurants(ACTOR, { cityId: 'aziziyah', filters: {} });
      expect(cards.length).toBe(w.restaurants.length);
      expect(cards.some((c) => homeIds.has(c.id))).toBe(false);
    }
  });

  it('switch on: a reservation dish has its bookable week; a ready dish has none', async () => {
    const w = await world();
    w.switchOn['aziziyah'] = true;
    const um = w.byKey('um_hussein');
    const menu = await w.catalog.menu(um.orgId);
    const biryani = menu.find((i) => i.nameAr === 'برياني دجاج')!;
    const slots = await w.rpc.homeSlots(ACTOR, { merchantId: um.orgId, itemId: biryani.id });
    expect(slots.aheadMin).toBe(240);
    // 18:12 Saturday, 4 h ahead: tonight's 19:00 is too soon, so the week starts Sunday 13:00.
    expect(slots.days[0]!.day).toBe('2026-10-04');
    expect(slots.days[0]!.slots[0]).toEqual({ at: new Date('2026-10-04T10:00:00Z'), left: 8 });
    const dolma = menu.find((i) => i.homeSale?.mode === 'ready')!;
    expect(await code(w.rpc.homeSlots(ACTOR, { merchantId: um.orgId, itemId: dolma.id }))).toBe('catalog_item_unavailable');
  });
});
