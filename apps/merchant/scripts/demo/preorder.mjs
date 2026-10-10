// Pre-orders on the kitchen board: a food order booked for tomorrow stays off the board until it is
// offered to the kitchen (T − prep − lead), then rings with its 90-s countdown and can be accepted.
//
//   POST /demo/preorder/place     clear the new column and book a pre-order for tomorrow 14:00 → { orderId }
//   POST /demo/preorder/offer?id= offer it to the kitchen now, exactly as its scheduled timer would
export default async function register(ctx) {
  const { orders } = ctx.services;
  const { khalid } = ctx.stores;
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  let seq = 0;

  ctx.route('/demo/preorder/place', async () => {
    const live = await orders.listActive({ merchantOrgId: khalid.orgId });
    for (const o of live) if (o.state === 'placed') await orders.merchantReject('system:demo', { orderId: o.id, reason: 'demo_reset' }).catch(() => undefined);
    // Tomorrow 14:00 Baghdad (UTC+3).
    const day = new Date(Date.now() + 3 * 3_600_000 + 86_400_000);
    const scheduledFor = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0));
    const lines = [await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'pepsi', 2), await ctx.line(khalid, 'salad', 1)];
    const o = await orders.place(`demo-preorder-${++seq}`, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, paymentMethod: 'cash', dropoff: HOME, lines, scheduledFor });
    const { ticketNumber } = await ctx.load('modules/merchant/index.js');
    return { orderId: o.id, number: ticketNumber(o.id) };
  });

  ctx.route('/demo/preorder/offer', async (_req, _res, url) => {
    const { ORDER_JOBS } = await ctx.load('modules/orders/index.js');
    const orderId = url.searchParams.get('id');
    await orders.handleTimer(ORDER_JOBS.offerToMerchant, { orderId });
    return { orderId, offeredAt: (await orders.get(orderId)).merchantOfferedAt };
  });
}
