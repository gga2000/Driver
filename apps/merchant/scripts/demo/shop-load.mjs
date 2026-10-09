// Shop picks from lane A's server work (PR #75, `docs/api/shop-load.md`) on مطعم خالد's board:
// l4 (15 waiting orders → automatic busy) and c6 (remake paid). h5 (paused while the app is away) is
// the app's own count from its last answered heartbeat, so it needs no hook: the shots stop the API
// from answering and keep the last beat on the device.
//
//   POST /demo/shop/crowd?count=12    `count` more accepted orders (with the seeded ones: 15+ waiting)
//   POST /demo/shop/crowd?count=0     cancels the crowd again
//   POST /demo/shop/remake?on=1       readies an order 12 minutes ago with its courier still on the way
//                                     (remake pay is on: Ali, 2026-10-08, lane A #81); on=0 switches the
//                                     rule off in this demo process only, to show the app with it off
export default async function register(ctx) {
  const { orders, ledger } = ctx.services;
  const { khalid } = ctx.stores;
  const { ORDERS_REPOSITORY } = await ctx.load('modules/orders/orders.repository.js');
  const { ORDER_OUTCOME_RULES } = await ctx.load('modules/orders/index.js');
  const repo = ctx.app.get(ORDERS_REPOSITORY, { strict: false });
  const rules = ctx.app.get(ORDER_OUTCOME_RULES, { strict: false });
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const { multi, ali } = ctx.people;
  let seq = 0;

  const place = async (lines) => {
    const who = `demo-shop-load-${++seq}`;
    // Prepaid, so a brand-new demo customer's cash cap never gets in the way.
    const account = ctx.Accounts.customer(who);
    await ledger.recordAll({ id: `demo:topup:${who}`, kind: 'money', occurredAt: new Date(), refs: {}, lines: [{ type: 'credit_issued', amount: 100_000, fromAccount: ctx.Accounts.bank, toAccount: account, memo: 'topup:agent' }], controls: [{ account, net: 100_000 }] });
    return orders.place(who, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, paymentMethod: 'wallet', dropoff: HOME, lines });
  };
  const baskets = [
    async () => [await ctx.line(khalid, 'tikka_wrap', 2, { choose: ['صمون حجري'] }), await ctx.line(khalid, 'pepsi', 2)],
    async () => [await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'salad', 1)],
    async () => [await ctx.line(khalid, 'gus_wrap', 3), await ctx.line(khalid, 'water', 2)],
  ];

  const crowd = [];
  ctx.route('/demo/shop/crowd', async (_req, _res, url) => {
    const count = Math.min(20, Math.max(0, Number(url.searchParams.get('count') ?? 12)));
    for (const id of crowd.splice(0)) {
      await repo.update(id, { state: 'cancelled', closedAt: new Date(), closedById: 'system:demo' }).catch(() => undefined);
    }
    for (let i = 0; i < count; i++) {
      const o = await place(await baskets[i % baskets.length]());
      await orders.merchantAccept((i % 2 ? ali : multi).id, { orderId: o.id, prepMinutes: 15 });
      crowd.push(o.id);
    }
    return { orderIds: [...crowd] };
  });

  const remakes = [];
  ctx.route('/demo/shop/remake', async (_req, _res, url) => {
    const on = url.searchParams.get('on') !== '0';
    rules.remake.pay = on;
    if (!on) return { pay: false };
    // One remake order at a time: the last one (already paid in an earlier shot) leaves the board.
    for (const id of remakes.splice(0)) {
      await repo.update(id, { state: 'cancelled', closedAt: new Date(), closedById: 'system:demo' }).catch(() => undefined);
    }
    const o = await place([await ctx.line(khalid, 'tikka_plate', 1, { choose: ['نفرين'] }), await ctx.line(khalid, 'water', 2)]);
    await orders.merchantAccept(multi.id, { orderId: o.id, prepMinutes: 10 });
    await orders.markReady(ali.id, { orderId: o.id });
    await repo.update(o.id, { readyAt: new Date(Date.now() - 12 * 60_000) });
    remakes.push(o.id);
    return { pay: true, orderId: o.id };
  });
}
