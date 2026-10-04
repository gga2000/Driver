// Deals section (wave 2): four weeks of مطعم خالد's delivered orders (so the server's projected cost
// has a basis: dinners heavy, Thursday/Friday busiest) and five deals in every state the list shows —
// running, waiting for Driver's approval, scheduled, paused and over.
//
//   POST /demo/deals/approve-pending     Driver approves every pending deal (the Console's switch)
const DAY = 86_400_000;

export default async function register(ctx) {
  const { orders } = ctx.services;
  const { khalid } = ctx.stores;
  const orgId = khalid.orgId;
  const { ORDERS_REPOSITORY } = await ctx.load('modules/orders/index.js');
  const { MerchantAdminService } = await ctx.load('modules/merchant-admin/index.js');
  const { PromotionsService } = await ctx.load('modules/promotions/index.js');
  const repo = ctx.app.get(ORDERS_REPOSITORY);
  const admin = ctx.app.get(MerchantAdminService);
  const promotions = ctx.app.get(PromotionsService);

  // ── order history: ~150 closed orders over the last 27 days ──
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const BASKETS = [
    [['tikka_wrap', 2], ['pepsi', 2]],
    [['tikka_plate', 1], ['salad', 1]],
    [['kebab_plate', 1], ['shenina', 1]],
    [['gus_wrap', 3], ['water', 1]],
    [['gus_plate', 1], ['torshi', 1]],
    [['khalid_mix', 1], ['pepsi', 2], ['salad', 1]],
    [['pacha', 1], ['lentil_soup', 2]],
    [['liver_wrap', 2], ['kebab_wrap', 2]],
    [['chicken_tikka_wrap', 2], ['pepsi', 1]],
    [['grill_mix_kilo', 1], ['pepsi', 3], ['salad', 2]],
  ];
  const now = Date.now();
  let placed = 0;
  for (let day = 27; day >= 1; day--) {
    const dow = new Date(now - day * DAY + 3 * 3_600_000).getUTCDay();
    const count = dow === 4 || dow === 5 ? 9 : 4 + Math.floor(rand() * 3);
    for (let n = 0; n < count; n++) {
      // Baghdad hour: lunch 13–15 or dinner 19–23.
      const hour = rand() < 0.3 ? 13 + Math.floor(rand() * 3) : 19 + Math.floor(rand() * 5);
      const local = Math.floor((now - day * DAY + 3 * 3_600_000) / DAY) * DAY + hour * 3_600_000 + Math.floor(rand() * 3_600_000);
      const at = new Date(local - 3 * 3_600_000);
      const basket = pick(BASKETS);
      const lines = [];
      for (const [key, qty] of basket) lines.push(await ctx.line(khalid, key, qty));
      // New customers' first cash orders are capped at 25,000; the big trays go prepaid.
      const big = basket.some(([key]) => key === 'grill_mix_kilo' || key === 'khalid_mix');
      const paymentMethod = !big && rand() < 0.7 ? 'cash' : 'wallet';
      // A wallet order needs a wallet that covers it (wallet_insufficient): the customer topped up first.
      if (paymentMethod === 'wallet') {
        const account = ctx.Accounts.customer(`demo-history-${placed}`);
        await ctx.services.ledger.recordAll({ id: `demo:topup:history-${placed}`, kind: 'money', occurredAt: at, refs: {}, lines: [{ type: 'credit_issued', amount: 100_000, fromAccount: ctx.Accounts.bank, toAccount: account, memo: 'topup:agent' }], controls: [{ account, net: 100_000 }] });
      }
      const o = await orders.place(`demo-history-${placed}`, {
        cityId: 'aziziyah',
        type: 'food',
        merchantOrgId: orgId,
        paymentMethod,
        dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
        lines,
      });
      const rec = repo.orders?.get(o.id);
      if (rec) {
        const min = 60_000;
        Object.assign(rec, { placedAt: at, state: 'closed', acceptedAt: new Date(at.getTime() + min), preparingAt: new Date(at.getTime() + min), promisedReadyAt: new Date(at.getTime() + 16 * min), readyAt: new Date(at.getTime() + 18 * min), pickedUpAt: new Date(at.getTime() + 21 * min), deliveredAt: new Date(at.getTime() + 34 * min), closedAt: new Date(at.getTime() + 40 * min) });
      }
      placed += 1;
    }
  }

  // ── deals ──
  const owner = { personId: ctx.people.owner.id, sessionId: 'demo' };
  const reviewer = 'demo-support';
  const id = (key) => khalid.itemIds.get(key);
  const baghdadMidnight = (offsetDays) => new Date(Math.floor((now + 3 * 3_600_000) / DAY) * DAY + offsetDays * DAY - 3 * 3_600_000);

  const tikka = await admin.dealsPropose(owner, {
    merchantOrgId: orgId,
    type: 'percent',
    value: 20,
    nameAr: 'تكة الويكند',
    itemIds: ['tikka_wrap', 'chicken_tikka_wrap', 'tikka_plate'].map(id),
    schedule: { startsAt: new Date(now - 2 * DAY), endsAt: baghdadMidnight(12), days: [4, 5], hours: { start: '19:00', end: '23:00' } },
    budgetCapIqd: 150_000,
    minOrderIqd: 0,
  });
  await promotions.review(tikka.dealId, true, reviewer);

  await admin.dealsPropose(owner, {
    merchantOrgId: orgId,
    type: 'free_delivery',
    value: 0,
    nameAr: 'توصيل ببلاش فوق 15,000',
    itemIds: [],
    schedule: { startsAt: new Date(now), endsAt: baghdadMidnight(14), days: [] },
    minOrderIqd: 15_000,
  });

  const bogo = await admin.dealsPropose(owner, {
    merchantOrgId: orgId,
    type: 'bogo',
    value: 0,
    nameAr: 'لفة كص واحد ويا واحد',
    itemIds: [id('gus_wrap')],
    schedule: { startsAt: baghdadMidnight(3), endsAt: baghdadMidnight(10), days: [], hours: { start: '12:00', end: '16:00' } },
    budgetCapIqd: 100_000,
    minOrderIqd: 0,
  });
  await promotions.review(bogo.dealId, true, reviewer);

  const pacha = await admin.dealsPropose(owner, {
    merchantOrgId: orgId,
    type: 'fixed',
    value: 1000,
    nameAr: 'باجة الصبح',
    itemIds: [id('pacha')],
    schedule: { startsAt: new Date(now), endsAt: baghdadMidnight(20), days: [5, 6] },
    minOrderIqd: 0,
  });
  await promotions.review(pacha.dealId, true, reviewer);
  await promotions.setActive(orgId, pacha.dealId, false, owner.personId);

  // An old one that already ran (stored directly: proposals can't be in the past).
  await promotions.propose({
    cityId: 'aziziyah',
    merchantOrgId: orgId,
    ownerId: owner.personId,
    nameAr: 'خصم افتتاح الفرع 10%',
    type: 'percent',
    value: 10,
    itemIds: [],
    schedule: { startsAt: new Date(now - 40 * DAY), endsAt: new Date(now - 26 * DAY), days: [] },
    minOrderIqd: 0,
    projection: { ordersPerWeek: 31.5, costPerOrderIqd: 1350, weeklyCostIqd: 42_500, totalCostIqd: 85_000, basisOrders: 126 },
    requireApproval: false,
  });

  ctx.route('/demo/deals/approve-pending', async () => {
    const list = await promotions.list(orgId);
    for (const d of list) if (d.state === 'pending_approval') await promotions.review(d.dealId, true, reviewer);
    return { ok: true };
  });
}
