// Chat section: the kitchen's conversations about an order (notifications & support §2).
//
//   POST /demo/chat/fresh   a new preparing order at مطعم خالد with a courier on his way, a customer
//                           with an account, and both conversations going → {orderId, number}
//
// The courier asked how long the order needs; the customer asked for no tomato. Messages go through
// the real ChatService, so badges, read receipts and quick replies are the API's.
export default async function register(ctx) {
  const { orders, trips, dispatch, identity, vehicles } = ctx.services;
  const { khalid } = ctx.stores;
  const { ChatService } = await ctx.load('modules/chat/index.js');
  const { ticketNumber } = await ctx.load('modules/merchant/index.js');
  const chat = ctx.app.get(ChatService);
  const as = (personId) => ({ personId, sessionId: 'demo' });
  let n = 0;
  const cid = () => `demo-${Date.now().toString(36)}-${++n}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const customerId = await identity.ensurePersonByPhone('07712880001', 'system:demo', 'demo');
  await identity.updateProfile({ personId: customerId, sessionId: 'demo' }, { name: 'زينب' });

  let courierSeq = 0;
  async function courier(at) {
    courierSeq += 1;
    const phone = `07714${String(560000 + courierSeq).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'courier' });
    await identity.setName({ personId: id, sessionId: 'demo' }, 'عباس فاضل');
    vehicles.register?.(id, { vehicleClass: 'bike', plate: `واسط ${51200 + courierSeq}` });
    await dispatch.presence.online(id, { cityId: 'aziziyah', at, vehicle: 'bike', tier: 'silver' });
    return id;
  }

  async function fresh() {
    const order = await orders.place(customerId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
      lines: [await ctx.line(khalid, 'gus_wrap', 2), await ctx.line(khalid, 'salad', 1)],
    });
    await orders.merchantAccept(ctx.people.owner.id, { orderId: order.id, prepMinutes: 15 });
    await orders.markPreparing(ctx.people.owner.id, { orderId: order.id });
    let trip = null;
    for (let i = 0; i < 40 && !trip; i++) {
      trip = await trips.activeForOrder(order.id);
      if (!trip) await sleep(100);
    }
    if (!trip) throw new Error(`no trip for ${order.id}`);
    const at = { lat: 32.915, lng: 45.061 };
    const c = await courier(at);
    const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: c, reason: 'demo' });
    await dispatch.respond({ personId: c, sessionId: 'demo' }, { offerId, accept: true });
    await trips.reportPosition(c, { tripId: trip.id, pin: at, at: new Date(), bearing: 200, speedKmh: 20 });

    await chat.send(as(c), { orderId: order.id, kind: 'merchant_courier', clientId: cid(), quickReplyKey: 'courier_how_long' });
    await chat.send(as(c), { orderId: order.id, kind: 'merchant_courier', clientId: cid(), text: 'أني يم الإشارة، أوصل بعد شوية' });
    await chat.send(as(customerId), { orderId: order.id, kind: 'customer_merchant', clientId: cid(), quickReplyKey: 'customer_have_note' });
    await chat.send(as(customerId), { orderId: order.id, kind: 'customer_merchant', clientId: cid(), text: 'الكص بدون طماطة لو سمحتوا' });
    return { orderId: order.id, number: ticketNumber(order.id), courierId: c };
  }

  await fresh();
  ctx.route('/demo/chat/fresh', () => fresh());
}
