// Board section (wave 1): مطعم خالد's live board, cash balance and printer marker.
//
// Seeds 3 new orders (a group order for 3 people with notes, a cash order, a prepaid one), 2 being
// prepared (one courier on his way, one still being found) and 2 ready (courier at the counter, courier
// on his way), plus 87,500 دينار on the cash account and the printer reported as disconnected.
// New orders auto-reject after 90 s like in production, so screenshots call /demo/board/fresh first.
//
//   POST /demo/board/fresh                      replace the new column with 3 fresh orders
//   POST /demo/board/printer?state=connected|disconnected
//   POST /demo/board/store?open=1&busy=0        reset the store switches
export default async function register(ctx) {
  const { orders, orgs, trips, dispatch, identity, ledger, vehicles } = ctx.services;
  const { khalid } = ctx.stores;
  const kitchen = khalid.seed.pin;
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const NORTH = { lat: 32.9215, lng: 45.0598 };
  let seq = 0;
  const customer = () => `demo-customer-${++seq}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const place = async (lines, patch = {}) =>
    orders.place(customer(), { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, paymentMethod: 'cash', dropoff: HOME, lines, ...patch });

  // ── the three new orders ──
  async function placeNew() {
    const group = await place(
      [
        await ctx.line(khalid, 'tikka_wrap', 2, { choose: ['صمون حجري', 'عمبة'], note: 'بدون بصل' }),
        await ctx.line(khalid, 'gus_plate', 1, { participantRef: 'abu', note: 'الكص مقرمش' }),
        await ctx.line(khalid, 'liver_wrap', 1, { participantRef: 'minar', choose: ['خبز تنور'] }),
        await ctx.line(khalid, 'shenina', 1, { participantRef: 'minar' }),
      ],
      {
        participants: [
          { ref: 'abu', role: 'diner', label: 'أبو حسين', note: 'حار هواي' },
          { ref: 'minar', role: 'diner', label: 'منار' },
        ],
        note: 'دگ الجرس مرتين، البيت الثالث بعد الفرن',
      },
    );
    const cash = await place([await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'pepsi', 2), await ctx.line(khalid, 'salad', 1)]);
    const prepaid = await place([await ctx.line(khalid, 'pacha', 1, { note: 'ويا خبز تنور زيادة' }), await ctx.line(khalid, 'lentil_soup', 2)], { paymentMethod: 'wallet' });
    return [group, cash, prepaid];
  }

  // ── couriers (named, verified, with a plate) ──
  const NAMES = ['حيدر كاظم', 'عباس فاضل', 'كرار عادل', 'مرتضى سالم'];
  let courierSeq = 0;
  async function newCourier(at) {
    courierSeq += 1;
    const phone = `07713${String(450000 + courierSeq).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'courier' });
    await identity.setName({ personId: id, sessionId: 'demo' }, NAMES[(courierSeq - 1) % NAMES.length]);
    vehicles.register?.(id, { vehicleClass: 'bike', plate: `واسط ${45670 + courierSeq}`, label: null });
    await dispatch.presence.online(id, { cityId: 'aziziyah', at, vehicle: 'bike', tier: 'silver' });
    return id;
  }
  async function tripOf(orderId) {
    for (let i = 0; i < 40; i++) {
      const t = await trips.activeForOrder(orderId);
      if (t) return t;
      await sleep(100);
    }
    throw new Error(`no trip for ${orderId}`);
  }
  async function assign(orderId, courierId) {
    const trip = await tripOf(orderId);
    const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: courierId, reason: 'demo' });
    await dispatch.respond({ personId: courierId, sessionId: 'demo' }, { offerId, accept: true });
    return trip.id;
  }
  const accept = (orderId, prepMinutes) => orders.merchantAccept('demo-staff', { orderId, prepMinutes });

  // ── preparing ──
  const p1 = await place([await ctx.line(khalid, 'grill_mix_kilo', 1, { note: 'نص مستوي ونص عادي' }), await ctx.line(khalid, 'torshi', 1)]);
  await accept(p1.id, 25);
  const c1 = await newCourier(NORTH);
  const t1 = await assign(p1.id, c1);
  await trips.reportPosition(c1, { tripId: t1, pin: NORTH, at: new Date(), bearing: 180, speedKmh: 22 });

  const p2 = await place([await ctx.line(khalid, 'gus_wrap', 2), await ctx.line(khalid, 'lamb_tikka_plate', 1)], { paymentMethod: 'wallet' });
  await accept(p2.id, 15);

  // ── ready ──
  const r1 = await place([await ctx.line(khalid, 'tikka_plate', 1, { choose: ['نفرين'] }), await ctx.line(khalid, 'water', 2)]);
  await accept(r1.id, 10);
  const c2 = await newCourier(kitchen);
  const t2 = await assign(r1.id, c2);
  await orders.markReady('demo-staff', { orderId: r1.id });
  await trips.reportPosition(c2, { tripId: t2, pin: kitchen, at: new Date(), bearing: 90, speedKmh: 0 });
  const pickup = (await trips.get(t2)).stops.find((s) => s.type === 'pickup');
  await trips.arrive(t2, pickup.id, c2, { pin: kitchen });

  const r2 = await place([await ctx.line(khalid, 'khalid_mix', 1)], { paymentMethod: 'wallet' });
  await accept(r2.id, 10);
  const c3 = await newCourier({ lat: 32.915, lng: 45.061 });
  const t3 = await assign(r2.id, c3);
  await orders.markReady('demo-staff', { orderId: r2.id });
  await trips.reportPosition(c3, { tripId: t3, pin: { lat: 32.915, lng: 45.061 }, at: new Date(), bearing: 200, speedKmh: 18 });

  await placeNew();

  // ── cash account and printer marker ──
  const group = (id, at, lines) => ({ id, kind: 'money', occurredAt: at, refs: {}, lines, controls: [] });
  const ago = (h) => new Date(Date.now() - h * 3_600_000);
  const cashAccount = ctx.Accounts.merchantCash(khalid.orgId);
  await ledger.recordAll([
    group('demo:khalid:1', ago(5), [{ type: 'merchant_payable', amount: 34_000, fromAccount: ctx.Accounts.customer('demo-c-a'), toAccount: cashAccount, memo: 'items' }]),
    group('demo:khalid:2', ago(3), [{ type: 'merchant_payable', amount: 28_500, fromAccount: ctx.Accounts.customer('demo-c-b'), toAccount: cashAccount, memo: 'items' }]),
    group('demo:khalid:3', ago(1), [{ type: 'merchant_payable', amount: 25_000, fromAccount: ctx.Accounts.customer('demo-c-c'), toAccount: cashAccount, memo: 'items' }]),
  ]);
  orgs.setMerchantSettings(khalid.orgId, { printer: { state: 'disconnected', name: 'XP-80C', at: new Date() } });

  // ── hooks ──
  ctx.route('/demo/board/fresh', async () => {
    const live = await orders.listActive({ merchantOrgId: khalid.orgId });
    for (const o of live) if (o.state === 'placed') await orders.merchantReject('demo-staff', { orderId: o.id, reason: 'demo_reset' }).catch(() => undefined);
    const fresh = await placeNew();
    return { orderIds: fresh.map((o) => o.id) };
  });
  ctx.route('/demo/board/printer', async (_req, _res, url) => {
    const state = url.searchParams.get('state') === 'connected' ? 'connected' : 'disconnected';
    orgs.setMerchantSettings(khalid.orgId, { printer: { state, name: 'XP-80C', at: new Date() } });
    return { state };
  });
  ctx.route('/demo/board/store', async (_req, _res, url) => {
    const open = url.searchParams.get('open') !== '0';
    const busy = url.searchParams.get('busy') === '1';
    orgs.setMerchantSettings(khalid.orgId, { closed: open ? null : { reason: 'power_cut', note: null, at: new Date() }, busyUntil: busy ? new Date(Date.now() + 60 * 60_000) : null });
    return { open, busy };
  });
}
