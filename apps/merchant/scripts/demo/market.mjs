// السوق (shopping, 2026-10-11): two produce stalls and two bakeries, as on the customer demo, on a
// morning when the stalls have not posted yet (yesterday's prices stand). Two owners sign in:
//   0770 778 0001  owner of بسطية أبو حيدر  → المزيد › «أسعار اليوم»
//   0770 778 0002  owner of فرن الحاج كاظم  → المزيد › «الفرن»
// GET /demo/market lists the shops.
export default async function register(ctx) {
  const { orgs, catalog, identity } = ctx.services;
  const { ShoppingService, seedDemoShops } = await ctx.load('modules/shopping/index.js');
  const shops = await seedDemoShops(orgs, catalog, ctx.app.get(ShoppingService), { ownerId: 'demo-owner', morning: true });
  const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };
  const owners = [
    ['07707780001', 'abu-haider', 'أبو حيدر'],
    ['07707780002', 'haj-kadhim', 'الحاج كاظم'],
  ];
  for (const [phone, key, name] of owners) {
    const shop = shops.find((s) => s.key === key);
    if (!shop) continue;
    const id = await identity.ensurePersonByPhone(phone, 'system:demo', 'demo');
    await identity.updateProfile({ personId: id, sessionId: 'demo' }, { name });
    await identity.grantRole(SYSTEM, { personId: id, kind: 'merchant_owner', orgId: shop.orgId });
  }
  ctx.route('/demo/market', () => shops);
}
