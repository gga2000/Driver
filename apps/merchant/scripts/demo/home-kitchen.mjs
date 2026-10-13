// أكل بيت section: the four demo home kitchens (@driver/contracts/seeds/demo-home-kitchens), the city's
// home-kitchen switch on, and أم حسين signed in as her kitchen's owner:
//
//   0770 888 0000  أم حسين, owner of مطبخ أم حسين   → board; «أكلاتي» from «المحل»
//
// Her biryani has two reservations at its first time (3 and 2 plates) and her quzi one (2 plates), so
// the reservations list and the «محجوزة» counts have something to show.
//
//   POST /demo/home-kitchen/reset   her dishes back to the seed (plates, rules) — screenshots call it first
import { fileURLToPath, pathToFileURL } from 'node:url';

export default async function register(ctx) {
  const { orgs, catalog, identity, orders } = ctx.services;
  const { seedStorefronts, CatalogRpc } = await ctx.load('modules/catalog/index.js');
  const { ConfigService } = await ctx.load('modules/config/index.js');
  const seedsUrl = new URL('../../../../packages/contracts/dist/seeds/demo-home-kitchens.js', import.meta.url);
  const { DEMO_HOME_KITCHENS } = await import(pathToFileURL(fileURLToPath(seedsUrl)).href);
  const kitchens = await seedStorefronts(orgs, catalog, DEMO_HOME_KITCHENS, 'demo-owner');
  ctx.app.get(ConfigService).setHomeKitchensOpen('aziziyah', true);
  for (const k of kitchens) {
    const front = await catalog.storefront(k.orgId);
    if (front && front.hours.length > 0) await catalog.saveStorefront({ ...front, hours: [] });
  }
  await orgs.settled?.();
  ctx.stores.all.push(...kitchens);
  const umHussein = kitchens.find((k) => k.seed.key === 'um_hussein');

  const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };
  const cook = await identity.ensurePersonByPhone('07708880000', 'system:demo', 'demo');
  await identity.updateProfile({ personId: cook, sessionId: 'demo' }, { name: 'أم حسين' });
  await identity.grantRole(SYSTEM, { personId: cook, kind: 'merchant_owner', orgId: umHussein.orgId });
  ctx.people.cook = { phone: '07708880000', id: cook };

  // Reservations: the first free time of each reserved dish, as a few customers booked it.
  const DROP = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const rpc = ctx.app.get(CatalogRpc);
  let n = 0;
  for (const [key, qtys] of [['biryani', [2, 2, 1]], ['quzi', [1]]]) {
    const itemId = umHussein.itemIds.get(key);
    const { days } = await rpc.homeSlots({ actor: null, ip: null }, { merchantId: umHussein.orgId, itemId });
    const at = days[0]?.slots[0]?.at;
    if (!at) continue;
    for (const qty of qtys) {
      try {
        await orders.place(`demo-home-cook-${++n}`, { cityId: 'aziziyah', type: 'food', merchantOrgId: umHussein.orgId, lines: [{ catalogItemId: itemId, qty }], paymentMethod: 'cash', dropoff: DROP, scheduledFor: at });
      } catch (err) {
        console.log(`DEMO_API home-kitchen: reservation not placed (${err?.code ?? err})`);
      }
    }
  }

  ctx.route('/demo/home-kitchen/reset', async () => {
    const now = new Date();
    const { homeLocalDay } = await import(pathToFileURL(fileURLToPath(new URL('../../../../packages/contracts/dist/index.js', import.meta.url))).href);
    for (const item of umHussein.seed.categories.flatMap((c) => c.items)) {
      const id = umHussein.itemIds.get(item.key);
      if (!id || !item.home) continue;
      const sale = item.home.mode === 'ready' ? { mode: 'ready', cooked: item.home.cooked, cookedOn: homeLocalDay(now), setAt: now.toISOString() } : { mode: 'reserve', rule: item.home.rule };
      await catalog.upsertItem(umHussein.orgId, { itemId: id, patch: { homeSale: sale, stock: item.home.mode === 'ready' ? item.home.left : null, available: true } }, 'demo-owner');
    }
    return { ok: true, orgId: umHussein.orgId };
  });
}
