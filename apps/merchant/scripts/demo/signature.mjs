// Phase 3 signature moments (UI/UX audit merchant-and-console §8): the courier at the pass (S-M4),
// the money pill states (S-M5) and the end-of-day card (S-M6) on demand.
//
//   POST /demo/signature/at-pass?waited=4        a ready order whose courier حيدر (plate واسط 45671) is
//                                                at the counter, arrived `waited` minutes ago (0 = now;
//                                                3+ turns the card amber). Called again: same order,
//                                                new waiting time; a fresh one once it was handed over.
//   POST /demo/signature/balance?kind=owed|owe   the header pill: Driver holds 87,500 for him, or
//                                                "عليك 4,250 دينار عمولة" (see also /demo/money/request)
//   POST /demo/signature/day-summary             closes the store for the day ("نسد وكت اليوم"): the
//                                                board shows today's summary card ("تمام" hides it on
//                                                the device). /demo/board/store?open=1 reopens.
const MIN = 60_000;

export default async function register(ctx) {
  const { orders, trips, dispatch, identity, vehicles, orgs, ledger } = ctx.services;
  const { khalid } = ctx.stores;
  const kitchen = khalid.seed.pin;
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const { TRIPS_REPOSITORY } = await ctx.load('modules/trips/index.js');
  const { MerchantCashService } = await ctx.load('modules/ledger/index.js');
  const { EventsService } = await ctx.load('modules/events/index.js');
  const events = ctx.app.get(EventsService);
  const { ticketNumber } = await ctx.load('modules/merchant/index.js');
  const tripsRepo = ctx.app.get(TRIPS_REPOSITORY, { strict: false });
  const cash = ctx.app.get(MerchantCashService);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // حيدر: the courier the brief names, with his bike plate.
  let haider = null;
  async function courier() {
    if (haider) return haider;
    const phone = '07714000001';
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    haider = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: haider, kind: 'courier' });
    await identity.setName({ personId: haider, sessionId: 'demo' }, 'حيدر كاظم');
    vehicles.register?.(haider, { vehicleClass: 'bike', plate: 'واسط 45671', label: null });
    await dispatch.presence.online(haider, { cityId: 'aziziyah', at: kitchen, vehicle: 'bike', tier: 'silver' });
    return haider;
  }
  async function tripOf(orderId) {
    for (let i = 0; i < 40; i++) {
      const t = await trips.activeForOrder(orderId);
      if (t) return t;
      await sleep(100);
    }
    throw new Error(`no trip for ${orderId}`);
  }

  let passOrderId = null;
  async function passOrder() {
    if (passOrderId) {
      const o = await orders.get(passOrderId).catch(() => null);
      if (o && o.state === 'ready' && !o.handedOverAt) return o;
    }
    const lines = [await ctx.line(khalid, 'tikka_plate', 1, { choose: ['نفرين'] }), await ctx.line(khalid, 'water', 2)];
    const o = await orders.place(`demo-pass-${Date.now().toString(36)}`, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, paymentMethod: 'cash', dropoff: HOME, lines });
    await orders.merchantAccept('demo-staff', { orderId: o.id, prepMinutes: 10 });
    const who = await courier();
    const trip = await tripOf(o.id);
    const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: who, reason: 'demo' });
    await dispatch.respond({ personId: who, sessionId: 'demo' }, { offerId, accept: true });
    await orders.markReady('demo-staff', { orderId: o.id });
    await trips.reportPosition(who, { tripId: trip.id, pin: kitchen, at: new Date(), bearing: 90, speedKmh: 0 });
    const pickup = (await trips.get(trip.id)).stops.find((s) => s.type === 'pickup');
    await trips.arrive(trip.id, pickup.id, who, { pin: kitchen });
    passOrderId = o.id;
    return orders.get(o.id);
  }

  ctx.route('/demo/signature/at-pass', async (_req, _res, url) => {
    const waited = Math.max(0, Math.min(60, Number(url.searchParams.get('waited') ?? 0)));
    const o = await passOrder();
    const trip = await tripOf(o.id);
    const pickup = trip.stops.find((s) => s.type === 'pickup' && s.orderId === o.id);
    const at = new Date(Date.now() - waited * MIN - 5_000);
    await tripsRepo.updateStop(pickup.id, { arrivedAt: at }, new Date());
    // The stop is rewritten behind the trips service's back (a real arrival can't be back-dated), so
    // no event tells the open board: nudge the store's live channel to re-read it, as a real
    // arrival would. On a real tablet the card turns amber on its own clock (m2a).
    await events.emit(undefined, { type: 'demo.pass_moved', actorId: 'system:demo', occurredAt: new Date(), payload: { orderId: o.id } }, { name: 'merchant', id: khalid.orgId });
    return { orderId: o.id, number: ticketNumber(o.id), arrivedAt: at };
  });

  ctx.route('/demo/signature/balance', async (_req, _res, url) => {
    const kind = url.searchParams.get('kind') === 'owe' ? 'owe' : 'owed';
    const target = kind === 'owe' ? -4_250 : 87_500;
    const balance = (await cash.balance(khalid.orgId)).balanceIqd;
    const diff = target - balance;
    if (diff !== 0) {
      const account = ctx.Accounts.merchantCash(khalid.orgId);
      const other = ctx.Accounts.customer('demo-signature');
      const line = diff > 0 ? { type: 'merchant_payable', amount: diff, fromAccount: other, toAccount: account, memo: 'items' } : { type: 'merchant_payout', amount: -diff, fromAccount: account, toAccount: ctx.Accounts.bank, memo: `zaincash:M-SIG-${Date.now().toString(36).slice(-4)}` };
      await ledger.recordAll({ id: `demo:signature:${Date.now().toString(36)}`, kind: 'money', occurredAt: new Date(), refs: {}, lines: [line], controls: [] });
    }
    return { balanceIqd: (await cash.balance(khalid.orgId)).balanceIqd };
  });

  ctx.route('/demo/signature/day-summary', async () => {
    orgs.setMerchantSettings(khalid.orgId, { closed: { reason: 'closing_early', note: null, at: new Date() } });
    return { closed: true };
  });
}
