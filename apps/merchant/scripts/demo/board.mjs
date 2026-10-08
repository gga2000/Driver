// Board section (wave 1): مطعم خالد's live board, cash balance and printer marker.
//
// Seeds 3 new orders (a group order for 3 people with notes, a cash order, a prepaid one), 2 being
// prepared (one courier on his way, one still being found) and 2 ready (courier at the counter, courier
// on his way), plus 87,500 دينار on the cash account and the printer reported as disconnected.
// New orders auto-reject after 90 s like in production, so screenshots call /demo/board/fresh first.
//
//   POST /demo/board/fresh                      replace the new column with 3 fresh orders
//   POST /demo/board/rush?count=10              a rush: replace the new column with `count` orders whose
//                                               90-s clocks are spread out (some nearly gone), one a group
//                                               order with an allergy note (M-05, M-06, M-09)
//   POST /demo/board/missed?count=2             orders that just timed out (the "طلبات فاتتك" strip)
//   POST /demo/board/printer?state=connected|disconnected
//   POST /demo/board/store?open=1&busy=0        reset the store switches
//   POST /demo/board/courier?metres=900          a ready order whose courier drives in from `metres` away
//                                               (a fix every 2 s, ≈ 30 km/h) and arrives at the counter:
//                                               the courier radar, the arriving chime and the pickup code
export default async function register(ctx) {
  const { orders, orgs, trips, dispatch, identity, ledger, vehicles } = ctx.services;
  const { khalid } = ctx.stores;
  const kitchen = khalid.seed.pin;
  const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
  const NORTH = { lat: 32.9215, lng: 45.0598 };
  let seq = 0;
  const customer = () => `demo-customer-${++seq}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const place = async (lines, patch = {}) => {
    try {
      return await placeAs(lines, patch);
    } catch (err) {
      // Decisions §4: a brand-new account's first cash orders are capped; a big demo basket (the grill
      // kilo) is paid from the wallet instead, as a real new customer would be asked to.
      if (patch.paymentMethod === undefined && err?.code === 'new_customer_cash_cap') return placeAs(lines, { ...patch, paymentMethod: 'wallet' });
      throw err;
    }
  };
  const placeAs = async (lines, patch) => {
    const who = customer();
    // A prepaid (wallet) order needs a wallet that covers it (orders.place refuses wallet_insufficient):
    // the demo customer topped up at an agent first.
    if (patch.paymentMethod === 'wallet') {
      const account = ctx.Accounts.customer(who);
      await ledger.recordAll({ id: `demo:topup:${who}`, kind: 'money', occurredAt: new Date(), refs: {}, lines: [{ type: 'credit_issued', amount: 100_000, fromAccount: ctx.Accounts.bank, toAccount: account, memo: 'topup:agent' }], controls: [{ account, net: 100_000 }] });
    }
    return orders.place(who, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, paymentMethod: 'cash', dropoff: HOME, lines, ...patch });
  };

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
        // M-09: the kitchen's note (with an allergy) and the courier's note are separate.
        note: 'منار عندها حساسية من الفستق، لا تحطون مكسرات',
        courierNote: 'دگ الجرس مرتين، البيت الثالث بعد الفرن',
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
    vehicles.register?.(id, { vehicleClass: 'bike', plate: `واسط ${45670 + courierSeq}` });
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
  // Real people press the buttons, so the owner's «مين سوّى شنو» has names: مصطفى and علي take turns.
  const { multi, ali } = ctx.people;
  let turn = 0;
  const accept = (orderId, prepMinutes) => orders.merchantAccept((turn++ % 2 ? ali : multi).id, { orderId, prepMinutes });
  // Clearing the new column between shots is the demo's doing, not a kitchen tap.
  const RESET = 'system:demo';

  // ── preparing ──
  const p1 = await place([await ctx.line(khalid, 'grill_mix_kilo', 1, { note: 'نص مستوي ونص عادي' }), await ctx.line(khalid, 'torshi', 1)]);
  await accept(p1.id, 25);
  const c1 = await newCourier(NORTH);
  const t1 = await assign(p1.id, c1);
  await trips.reportPosition(c1, { tripId: t1, pin: NORTH, at: new Date(), bearing: 180, speedKmh: 22 });

  const p2 = await place([await ctx.line(khalid, 'gus_wrap', 2), await ctx.line(khalid, 'lamb_tikka_plate', 1)], { paymentMethod: 'wallet' });
  await accept(p2.id, 15);
  await orders.merchantExtendPrep(ali.id, { orderId: p2.id });

  // One order مصطفى turned down in the rush (the owner sees who and why).
  const turnedDown = await place([await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'pepsi', 2), await ctx.line(khalid, 'salad', 1)]);
  await orders.merchantReject(multi.id, { orderId: turnedDown.id, reason: 'too_busy' });

  // ── ready ──
  const r1 = await place([await ctx.line(khalid, 'tikka_plate', 1, { choose: ['نفرين'] }), await ctx.line(khalid, 'water', 2)]);
  await accept(r1.id, 10);
  const c2 = await newCourier(kitchen);
  const t2 = await assign(r1.id, c2);
  await orders.markReady(ali.id, { orderId: r1.id });
  await trips.reportPosition(c2, { tripId: t2, pin: kitchen, at: new Date(), bearing: 90, speedKmh: 0 });
  const pickup = (await trips.get(t2)).stops.find((s) => s.type === 'pickup');
  await trips.arrive(t2, pickup.id, c2, { pin: kitchen });

  const r2 = await place([await ctx.line(khalid, 'khalid_mix', 1)], { paymentMethod: 'wallet' });
  await accept(r2.id, 10);
  const c3 = await newCourier({ lat: 32.915, lng: 45.061 });
  const t3 = await assign(r2.id, c3);
  await orders.markReady(multi.id, { orderId: r2.id });
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

  // ── a courier driving in (maps program SP7a) ──
  const STEP_M = 16; // per 2-s fix ≈ 30 km/h
  async function driveIn(metres) {
    const o = await place([await ctx.line(khalid, 'tikka_wrap', 2, { choose: ['صمون حجري', 'عمبة'] }), await ctx.line(khalid, 'pepsi', 1)]);
    await accept(o.id, 10);
    const dir = Math.random() * 2 * Math.PI;
    const toLat = (m) => m / 111_320;
    const toLng = (m) => m / (111_320 * Math.cos((kitchen.lat * Math.PI) / 180));
    let left = metres;
    const posAt = (m) => ({ lat: kitchen.lat + toLat(m * Math.cos(dir)), lng: kitchen.lng + toLng(m * Math.sin(dir)) });
    const courierId = await newCourier(posAt(left));
    const tripId = await assign(o.id, courierId);
    const heading = ((dir * 180) / Math.PI + 180) % 360;
    await trips.reportPosition(courierId, { tripId, pin: posAt(left), at: new Date(), bearing: heading, speedKmh: 28 });
    const timer = setInterval(async () => {
      try {
        left = Math.max(0, left - STEP_M);
        await trips.reportPosition(courierId, { tripId, pin: posAt(left), at: new Date(), bearing: heading, speedKmh: left > 0 ? 28 : 0 });
        if (left <= 20) {
          clearInterval(timer);
          const pickup = (await trips.get(tripId)).stops.find((st) => st.type === 'pickup');
          await trips.arrive(tripId, pickup.id, courierId, { pin: kitchen });
        }
      } catch (err) {
        clearInterval(timer);
        console.error('demo courier', err?.message ?? err);
      }
    }, 2000);
    return { orderId: o.id, courierId, tripId };
  }

  // ── hooks ──
  ctx.route('/demo/board/courier', async (_req, _res, url) => driveIn(Math.max(30, Number(url.searchParams.get('metres') ?? 900))));
  ctx.route('/demo/board/fresh', async () => {
    const live = await orders.listActive({ merchantOrgId: khalid.orgId });
    for (const o of live) if (o.state === 'placed') await orders.merchantReject(RESET, { orderId: o.id, reason: 'demo_reset' }).catch(() => undefined);
    const fresh = await placeNew();
    return { orderIds: fresh.map((o) => o.id) };
  });
  // A missed order (M-01) without waiting 90 s: places `count` orders and runs their auto-reject now,
  // exactly as the 90-s timer would (merchant_timeout, scored, the customer sees it cancelled).
  ctx.route('/demo/board/missed', async (_req, _res, url) => {
    const { ORDER_JOBS } = await ctx.load('modules/orders/index.js');
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count') ?? 1)));
    const ids = [];
    for (let i = 0; i < count; i++) {
      // Same baskets as the seeded new orders (above the restaurant minimum).
      const lines = i % 2 ? [await ctx.line(khalid, 'pacha', 1), await ctx.line(khalid, 'lentil_soup', 2)] : [await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'pepsi', 2), await ctx.line(khalid, 'salad', 1)];
      const o = await place(lines);
      const offered = await orders.get(o.id);
      await orders.handleTimer(ORDER_JOBS.autoReject, { orderId: o.id, refMs: new Date(offered.merchantOfferedAt).getTime() });
      ids.push(o.id);
    }
    return { orderIds: ids };
  });
  // Rush (M-05/M-06): `count` new orders at once, their offers spread over the last minute so the
  // rings differ (the most urgent has ~15 s left). Their auto-reject still runs at each real deadline.
  const rushTimers = [];
  ctx.route('/demo/board/rush', async (_req, _res, url) => {
    const { ORDER_JOBS } = await ctx.load('modules/orders/index.js');
    const { ORDERS_REPOSITORY } = await ctx.load('modules/orders/orders.repository.js');
    const repo = ctx.app.get(ORDERS_REPOSITORY, { strict: false });
    const count = Math.min(14, Math.max(3, Number(url.searchParams.get('count') ?? 10)));
    for (const t of rushTimers.splice(0)) globalThis.clearTimeout(t);
    const live = await orders.listActive({ merchantOrgId: khalid.orgId });
    for (const o of live) if (o.state === 'placed') await orders.merchantReject(RESET, { orderId: o.id, reason: 'demo_reset' }).catch(() => undefined);
    const baskets = [
      async () => [await ctx.line(khalid, 'kebab_plate', 1, { choose: ['نفر'] }), await ctx.line(khalid, 'pepsi', 2), await ctx.line(khalid, 'salad', 1)],
      async () => [await ctx.line(khalid, 'tikka_wrap', 3, { choose: ['صمون حجري'] }), await ctx.line(khalid, 'pepsi', 3)],
      async () => [await ctx.line(khalid, 'pacha', 1), await ctx.line(khalid, 'lentil_soup', 2)],
      async () => [await ctx.line(khalid, 'grill_mix_kilo', 1, { note: 'نص مستوي ونص عادي' }), await ctx.line(khalid, 'torshi', 1), await ctx.line(khalid, 'water', 4)],
      async () => [await ctx.line(khalid, 'gus_wrap', 2), await ctx.line(khalid, 'liver_wrap', 2, { choose: ['خبز تنور'] })],
    ];
    const ids = [];
    for (let i = 0; i < count; i++) {
      let o;
      if (i === 1) {
        // A group order for three with an allergy: long on a phone (the sticky accept bar), flagged on the card.
        o = await place(
          [
            await ctx.line(khalid, 'tikka_wrap', 2, { choose: ['صمون حجري', 'عمبة'], note: 'بدون بصل' }),
            await ctx.line(khalid, 'gus_plate', 1, { participantRef: 'abu', note: 'الكص مقرمش' }),
            await ctx.line(khalid, 'liver_wrap', 1, { participantRef: 'minar', choose: ['خبز تنور'] }),
            await ctx.line(khalid, 'shenina', 2, { participantRef: 'minar' }),
            await ctx.line(khalid, 'salad', 1),
          ],
          {
            participants: [
              { ref: 'abu', role: 'diner', label: 'أبو حسين', note: 'حار هواي' },
              { ref: 'minar', role: 'diner', label: 'منار', note: 'عندها حساسية من الفستق' },
            ],
            note: 'لا تحطون مكسرات بأي شي',
            courierNote: 'دگ الجرس مرتين، البيت الثالث بعد الفرن',
          },
        );
      } else {
        o = await place(await baskets[i % baskets.length](), i % 3 === 2 ? { paymentMethod: 'wallet' } : {});
      }
      // Spread the offers: the first placed has the least time left (~15 s), the last the most.
      const offeredAt = new Date(Date.now() - Math.max(0, 75_000 - i * Math.round(70_000 / count)));
      await repo.update(o.id, { merchantOfferedAt: offeredAt });
      const refMs = offeredAt.getTime();
      rushTimers.push(setTimeout(() => void orders.handleTimer(ORDER_JOBS.autoReject, { orderId: o.id, refMs }).catch(() => undefined), Math.max(0, refMs + 90_000 - Date.now())));
      ids.push(o.id);
    }
    return { orderIds: ids };
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
