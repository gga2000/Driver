// Food carts (عربانات, Ali 2026-10-11): Aziziyah's demo carts, and أبو حيدر who owns the liver cart:
//   0770 123 4500  owner of كبدة أبو حيدر  → the cart screen instead of the board
// The liver cart starts open by the souq garage with no tickets.
//
//   POST /demo/carts/close     the cart closes (the «فتحت هنا» screen)
//   POST /demo/carts/open      it opens again by the souq garage
//   POST /demo/carts/tickets   three walk-over tickets: two cooking (one late), one ready
const OWNER_PHONE = '07701234500';

export default async function register(ctx) {
  const { orgs, catalog, identity } = ctx.services;
  const { FoodCartsService, FOOD_CARTS_REPOSITORY, seedDemoCarts, DEMO_CARTS } = await ctx.load('modules/food-carts/index.js');
  const carts = ctx.app.get(FoodCartsService);
  const repo = ctx.app.get(FOOD_CARTS_REPOSITORY);
  const seeded = await seedDemoCarts(orgs, catalog, carts, { ownerId: 'demo-cart-owner' });
  const liver = seeded.find((c) => c.key === 'liver');

  const ownerId = await identity.ensurePersonByPhone(OWNER_PHONE, 'system:demo', 'demo');
  await identity.updateProfile({ personId: ownerId, sessionId: 'demo' }, { name: 'أبو حيدر' });
  await identity.grantRole({ personId: 'system:demo', sessionId: 'demo' }, { personId: ownerId, kind: 'merchant_owner', orgId: liver.orgId });
  const owner = { personId: ownerId, sessionId: 'demo' };
  const scope = { merchantOrgId: liver.orgId };
  const spot = DEMO_CARTS.find((d) => d.key === 'liver').open;

  const isOpen = async () => (await carts.owner(owner, scope)).cart.open;
  ctx.route('/demo/carts/close', async () => {
    if (await isOpen()) await carts.close(owner, scope);
    return { ok: true, orgId: liver.orgId };
  });
  ctx.route('/demo/carts/open', async () => {
    if (!(await isOpen())) await carts.openHere(owner, { ...scope, at: { lat: spot.lat, lng: spot.lng }, label: spot.label });
    return { ok: true, orgId: liver.orgId };
  });
  ctx.route('/demo/carts/tickets', async () => {
    if (!(await isOpen())) await carts.openHere(owner, { ...scope, at: { lat: spot.lat, lng: spot.lng }, label: spot.label });
    const item = (key) => `${liver.orgId}_${key}`;
    const orders = [
      { phone: '07704560001', lines: [{ itemId: item('laffa'), qty: 2 }, { itemId: item('maalak'), qty: 1 }], note: 'بدون طماطة', ready: true },
      { phone: '07704560002', lines: [{ itemId: item('plate'), qty: 1 }], late: true },
      { phone: '07704560003', lines: [{ itemId: item('samoon'), qty: 3 }] },
    ];
    const out = [];
    for (const o of orders) {
      const personId = await identity.ensurePersonByPhone(o.phone, 'system:demo', 'demo');
      const me = { personId, sessionId: 'demo' };
      for (const w of await carts.myWalkups(me)) if (w.state === 'placed') await carts.cancelWalkup(me, { walkupId: w.id });
      for (const w of await carts.myWalkups(me)) if (w.state === 'ready') await repo.updateWalkup(w.id, ['ready'], { state: 'expired' });
      const w = await carts.placeWalkup(me, { cartId: liver.cartId, lines: o.lines, ...(o.note ? { note: o.note } : {}) });
      // The in-memory repository takes any field, so the demo can age a ticket.
      const ago = (min) => new Date(Date.now() - min * 60_000);
      if (o.ready) await repo.updateWalkup(w.id, ['placed'], { state: 'ready', readyAt: ago(2), placedAt: ago(9), readyBy: ago(3) });
      if (o.late) await repo.updateWalkup(w.id, ['placed'], { placedAt: ago(11), readyBy: ago(5) });
      out.push(w.code);
    }
    return { ok: true, codes: out };
  });
}
