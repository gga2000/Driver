// Shop rules (Ali, 2026-10-08): a juice bar for the 3 / 5 / 8 prep choices (t5) and a dish photo
// waiting for the team's look (p4). Busy +10 / +20 (r5) and «وضعك» (x6) need nothing seeded: مطعم
// خالد's busy switch and five weeks of history already drive them.
//
// Seeds عصائر الربيع (the demo juice bar from @driver/contracts' DEMO_SHOPS, tags juice + smoothie),
// owner «ربيع» on 0770 444 0001, and marks خالد's «صحن كص» photo as just uploaded by the shop.
//
//   POST /demo/rules/juice-order       a fresh order at the juice bar (its accept sheet shows 3 / 5 / 8)
//   POST /demo/rules/photo?pending=1   «صحن كص»'s photo waiting for review (pending=0: reviewed)
import { fileURLToPath, pathToFileURL } from 'node:url';

export default async function register(ctx) {
  const { orgs, catalog, orders, identity } = ctx.services;
  const { khalid } = ctx.stores;
  const { seedStorefronts } = await ctx.load('modules/catalog/index.js');
  const { DEMO_SHOPS } = await import(pathToFileURL(fileURLToPath(new URL('../../../../packages/contracts/dist/seeds/demo-shops.js', import.meta.url))).href);

  // ── the juice bar ──
  const [juice] = await seedStorefronts(orgs, catalog, DEMO_SHOPS.filter((s) => s.key === 'rabee_juice'), 'demo-owner');
  const front = await catalog.storefront(juice.orgId);
  // Open around the clock with no minimum, like the other demo shops.
  if (front) await catalog.saveStorefront({ ...front, hours: process.env.DEMO_HOURS === 'real' ? front.hours : [], minOrderIqd: 0 });
  const ownerId = await identity.ensurePersonByPhone('07704440001', 'system:demo', 'demo');
  await identity.updateProfile({ personId: ownerId, sessionId: 'demo' }, { name: 'ربيع' });
  await identity.grantRole({ personId: 'system:demo', sessionId: 'demo' }, { personId: ownerId, kind: 'merchant_owner', orgId: juice.orgId });
  await orgs.settled?.();

  let seq = 0;
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const juiceOrder = async () => {
    const live = await orders.listActive({ merchantOrgId: juice.orgId });
    for (const o of live) if (o.state === 'placed') await orders.merchantReject('system:demo', { orderId: o.id, reason: 'demo_reset' }).catch(() => undefined);
    const lines = [await ctx.line(juice, 'orange', 2), await ctx.line(juice, 'banana_milk', 1), await ctx.line(juice, 'lemon_mint', 1)];
    return orders.place(`demo-juice-customer-${++seq}`, { cityId: 'aziziyah', type: 'food', merchantOrgId: juice.orgId, paymentMethod: 'cash', dropoff: HOME, lines });
  };

  // ── a dish photo the shop just put up ──
  const dishId = khalid.itemIds.get('gus_plate');
  const markPhoto = async (pending) => {
    const item = await catalog.adminItem(khalid.orgId, dishId);
    if (!item.photoUrl) return { pending: false };
    if (pending) await catalog.replacePhoto(khalid.orgId, dishId, item.photoUrl, undefined, null, true);
    else await catalog.markPhotoReviewed(dishId);
    return { pending };
  };
  await markPhoto(true);

  ctx.route('/demo/rules/juice-order', async () => ({ orderId: (await juiceOrder()).id, merchantOrgId: juice.orgId }));
  ctx.route('/demo/rules/photo', async (_req, _res, url) => markPhoto(url.searchParams.get('pending') !== '0'));
}
