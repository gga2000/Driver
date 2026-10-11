// An order the kitchen had accepted is cancelled: the board keeps it as a red «انلغى، لا تكمل» card
// for 15 minutes (until tapped away) instead of letting it vanish.
//
//   POST /demo/cancelled/one?ready=0|1   the customer cancels one of Khalid's cooking (ready=0) or
//                                        ready (ready=1) orders → { orderId, number }
export default async function register(ctx) {
  const { orders } = ctx.services;
  const { khalid } = ctx.stores;

  ctx.route('/demo/cancelled/one', async (_req, _res, url) => {
    const want = url.searchParams.get('ready') === '1' ? ['ready'] : ['merchant_accepted', 'preparing'];
    const live = await orders.listActive({ merchantOrgId: khalid.orgId });
    const o = live.find((x) => want.includes(x.state));
    if (!o) return { orderId: null };
    await orders.cancel(o.ordererId, { orderId: o.id, reason: 'changed_mind' });
    const { ticketNumber } = await ctx.load('modules/merchant/index.js');
    return { orderId: o.id, number: ticketNumber(o.id) };
  });
}
