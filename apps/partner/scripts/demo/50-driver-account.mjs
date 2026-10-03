// Driver account (wave 2): earnings history, documents, the daily check-in and the scorecard.
//
//   who=courier  0770 111 0001  checked in; two months of deliveries (tips, night/rain extras, batch, shift
//                               guarantee top-ups, cash orders paid to restaurants and settled daily);
//                               today ≈ 72 % of his 75,000 cap; scorecard day 65, bronze, 2 nudges
//   who=tuktuk   0770 111 0002  checked in; rides with the platform take; licence expiring in 12 days,
//                               registration rejected (reason), insurance under review
//   who=intercity / khat         checked in, papers approved (so their flows can go online)
//   who=rookie   0770 111 0041  حسين علي, courier, day 9: no check-in yet (home banner, blocked switch),
//                               observation scorecard, ID back under review, photo missing
//   who=locked   0770 111 0042  ياسر محمد, courier: two failed check-ins today → locked out
//   who=lapsed   0770 111 0043  أحمد ستار, tuktuk driver: licence expired 3 days ago → offline
//
//   POST /demo/account/fail-next-checkin?who=…   the next selfie he sends fails liveness (failure screen)
//
// The in-memory API has no past, so the scorecard's history (offer answers, completed trips and their
// ratings over the last weeks) is fed to `DriverAccountService` alone through demo-only wrappers of
// its event / trip / order reads. Money is real ledger postings, dated in the past.
import { Buffer } from 'node:buffer';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const OFF = 3 * HOUR; // Baghdad UTC+3
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** Deterministic pseudo-random (same demo every run). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

function startOfLocalDay(at) {
  const shifted = at + OFF;
  return shifted - (((shifted % DAY) + DAY) % DAY) - OFF;
}

export default async function register(demo) {
  const { services, Accounts } = demo;
  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const account = demo.app.get(DriverAccountService);
  const blobs = demo.app.get(BLOB_STORE);
  const actor = (personId) => ({ personId, sessionId: 'demo' });
  const reviewer = { personId: 'demo-field-ops', sessionId: 'demo' };
  const now = Date.now();
  const today = startOfLocalDay(now);

  async function photo(ownerId) {
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/jpeg', bytes: JPEG });
    return ticket.uploadId;
  }

  async function checkIn(personId, livenessScore = 0.97) {
    const c = await account.checkInChallenge(actor(personId));
    return account.submitCheckIn(actor(personId), { challengeId: c.challengeId, uploadId: await photo(personId), livenessScore });
  }

  /** Upload + review: `days` from now for the expiry (negative = expired), `reject` a reason, `pending` leaves it. */
  async function paper(personId, kind, opts = {}) {
    const d = await account.uploadDocument(actor(personId), { kind, uploadId: await photo(personId) });
    if (opts.pending) return d;
    const expiresAt = opts.days === undefined ? undefined : new Date(now + opts.days * DAY);
    return account.reviewDocument(reviewer, {
      documentId: d.id,
      decision: opts.reject ? 'reject' : 'approve',
      ...(opts.reject ? { reason: opts.reject } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  const ID = [
    ['national_id_front', { days: 900 }],
    ['national_id_back', { days: 900 }],
    ['photo', {}],
  ];
  const CAR = [...ID, ['licence', { days: 640 }], ['vehicle_registration', { days: 210 }]];

  // ── people and papers ─────────────────────────────────────────────
  const courier = demo.people.get('courier').personId;
  const tuktuk = demo.people.get('tuktuk').personId;
  const intercity = demo.people.get('intercity').personId;
  const khat = demo.people.get('khat').personId;
  const rookie = await demo.person({ key: 'rookie', phone: '07701110041', name: 'حسين علي', roles: ['courier'], vehicle: 'bike', plate: 'واسط 61822' });
  const locked = await demo.person({ key: 'locked', phone: '07701110042', name: 'ياسر محمد', roles: ['courier'], vehicle: 'bike', plate: 'واسط 70415' });
  const lapsed = await demo.person({ key: 'lapsed', phone: '07701110043', name: 'أحمد ستار', roles: ['driver'], vehicle: 'tuktuk', plate: 'واسط 29034' });

  for (const [kind, o] of ID) await paper(courier, kind, o);
  for (const [kind, o] of [...CAR, ['insurance', { days: 300 }]]) await paper(intercity, kind, o);
  for (const [kind, o] of CAR) await paper(khat, kind, o);
  for (const [kind, o] of ID) await paper(tuktuk, kind, o);
  await paper(tuktuk, 'licence', { days: 12 });
  await paper(tuktuk, 'vehicle_registration', { reject: 'صورة السنوية مقصوصة ورقم الشاصي مو واضح. صوّرها كاملة بضوء النهار' });
  await paper(tuktuk, 'insurance', { pending: true });
  await paper(rookie, 'national_id_front', { days: 1200 });
  await paper(rookie, 'national_id_back', { pending: true });
  for (const [kind, o] of [...ID, ['vehicle_registration', { days: 150 }]]) await paper(lapsed, kind, o);
  await paper(lapsed, 'licence', { days: -3 });
  for (const [kind, o] of ID) await paper(locked, kind, o);

  for (const id of [courier, tuktuk, intercity, khat, lapsed]) await checkIn(id);
  await checkIn(locked, 0.18);
  await checkIn(locked, 0.22);

  // ── money: the courier's last two months ─────────────────────────────────────────────────────
  const khalid = demo.restaurants.khalid?.orgId ?? 'demo-merchant';
  const r = rng(20261003);
  const groups = [];
  const settle = (personId, day, cashBack, earned) => {
    const at = Math.min(day + DAY + 10 * HOUR, now - 30 * 60_000);
    const lines = [];
    if (cashBack > 0) lines.push({ type: 'driver_settlement', amount: cashBack, fromAccount: Accounts.bank, toAccount: Accounts.cash(personId), memo: `ops_round:D-${String(day).slice(-8, -4)}-${String(day).slice(-4)}` });
    if (earned > 0) lines.push({ type: 'driver_payout', amount: earned, fromAccount: Accounts.driver(personId), toAccount: Accounts.bank, memo: 'zaincash:nightly' });
    if (lines.length) groups.push(demo.group(`demo:acct:${personId}:settle:${day}`, new Date(at), lines));
  };

  let seq = 0;
  for (let d = 64; d >= 1; d--) {
    const day = today - d * DAY;
    const dow = new Date(day + OFF).getUTCDay();
    const rainy = d === 9 || d === 10 || d === 23;
    const n = dow === 5 ? 4 + Math.floor(r() * 3) : 6 + Math.floor(r() * 5);
    let collected = 0;
    let paidMerchants = 0;
    let earned = 0;
    for (let j = 0; j < n; j++) {
      const hour = pick(r, [11, 12, 13, 13, 14, 14, 15, 18, 19, 19, 20, 20, 21, 21, 22, 23]);
      const at = new Date(day + hour * HOUR + Math.floor(r() * 55) * 60_000);
      const orderId = `demo-hist-${(++seq).toString(36).padStart(4, '0')}`;
      const fee = pick(r, [1000, 1500, 1500, 2000, 2000, 2500, 3000]);
      const lines = [{ type: 'delivery_fee', amount: fee, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier) }];
      earned += fee;
      if (hour >= 22) {
        lines.push({ type: 'delivery_fee', amount: 250, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier), memo: 'night' });
        earned += 250;
      }
      if (rainy) {
        lines.push({ type: 'delivery_fee', amount: 250, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier), memo: 'weather' });
        earned += 250;
      }
      if (r() < 0.1) {
        lines.push({ type: 'driver_incentive', amount: 500, fromAccount: Accounts.platform, toAccount: Accounts.driver(courier), memo: 'rebroadcast_compensation' });
        earned += 500;
      }
      if (r() < 0.27) {
        const tip = pick(r, [500, 500, 1000, 1000, 2000]);
        lines.push({ type: 'tip', amount: tip, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier) });
        earned += tip;
      }
      if (r() < 0.6) {
        const items = pick(r, [6000, 8500, 9000, 12000, 14500, 17000, 21000]);
        const total = items + fee + 500;
        lines.push({ type: 'cash_collected', amount: total, fromAccount: Accounts.cash(courier), toAccount: Accounts.customer('demo-buyer') });
        lines.push({ type: 'merchant_paid_by_courier', amount: items, fromAccount: Accounts.merchantCash(khalid), toAccount: Accounts.cash(courier), memo: `handover:${orderId}` });
        collected += total;
        paidMerchants += items;
      }
      groups.push(demo.group(`demo:acct:courier:${orderId}`, at, lines, { orderId }));
    }
    // Launch shift guarantee (money §2): topped up on a few slow evening shifts.
    if (d % 6 === 2) {
      const top = pick(r, [1500, 2000, 2500]);
      groups.push(demo.group(`demo:acct:courier:guarantee:${d}`, new Date(day + 23 * HOUR + 30 * 60_000), [{ type: 'driver_incentive', amount: top, fromAccount: Accounts.platform, toAccount: Accounts.driver(courier), memo: `guarantee:${new Date(day + OFF).toISOString().slice(0, 10)}:evening` }]));
      earned += top;
    }
    settle(courier, day, collected - paidMerchants, earned);
  }

  // Today on top of the core seed (6 deliveries, 45,000 cash): tips, cash orders, two restaurants paid.
  const todayLines = [
    ['demo-day-1', [{ type: 'tip', amount: 1000, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier) }, { type: 'cash_collected', amount: 9500, fromAccount: Accounts.cash(courier), toAccount: Accounts.customer('demo-buyer') }, { type: 'merchant_paid_by_courier', amount: 7500, fromAccount: Accounts.merchantCash(khalid), toAccount: Accounts.cash(courier) }], 5],
    ['demo-day-3', [{ type: 'cash_collected', amount: 14000, fromAccount: Accounts.cash(courier), toAccount: Accounts.customer('demo-buyer') }, { type: 'merchant_paid_by_courier', amount: 11000, fromAccount: Accounts.merchantCash(khalid), toAccount: Accounts.cash(courier) }], 3],
    ['demo-day-4', [{ type: 'tip', amount: 500, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier) }, { type: 'cash_collected', amount: 18500, fromAccount: Accounts.cash(courier), toAccount: Accounts.customer('demo-buyer') }], 2],
  ];
  for (const [orderId, lines, h] of todayLines) groups.push(demo.group(`demo:acct:courier:today:${orderId}`, demo.hoursAgo(h), lines, { orderId }));

  // The tuktuk: rides with the platform's take shown openly, last 10 days.
  const rt = rng(7);
  for (let d = 10; d >= 0; d--) {
    const day = today - d * DAY;
    const n = d === 0 ? 3 : 4 + Math.floor(rt() * 4);
    let earned = 0;
    let collected = 0;
    for (let j = 0; j < n; j++) {
      const at = d === 0 ? now - (j + 1) * 50 * 60_000 : day + pick(rt, [8, 9, 12, 13, 14, 17, 18, 19]) * HOUR + Math.floor(rt() * 50) * 60_000;
      const orderId = `demo-ride-${d}-${j}`;
      const fare = pick(rt, [2000, 2500, 3000, 3000, 3500, 4000]);
      const take = Math.round(fare * 0.1);
      groups.push(
        demo.group(`demo:acct:tuktuk:${orderId}`, new Date(at), [
          { type: 'fare', amount: fare, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(tuktuk) },
          { type: 'commission_accrued', amount: take, fromAccount: Accounts.driver(tuktuk), toAccount: Accounts.platform },
          { type: 'cash_collected', amount: fare, fromAccount: Accounts.cash(tuktuk), toAccount: Accounts.customer('demo-buyer') },
        ], { orderId }),
      );
      earned += fare - take;
      collected += fare;
    }
    if (d > 0) settle(tuktuk, day, collected, earned);
  }

  // The rookie's first week: a few deliveries a day.
  const rr = rng(41);
  for (let d = 8; d >= 1; d--) {
    const day = today - d * DAY;
    for (let j = 0; j < 3 + Math.floor(rr() * 3); j++) {
      const orderId = `demo-rookie-${d}-${j}`;
      groups.push(demo.group(`demo:acct:rookie:${orderId}`, new Date(day + pick(rr, [12, 13, 19, 20, 21]) * HOUR), [{ type: 'delivery_fee', amount: pick(rr, [1000, 1500, 2000]), fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(rookie) }], { orderId }));
    }
  }
  await services.ledger.recordAll(groups);

  // ── scorecard history (demo-only reads for DriverAccountService) ───
  const history = new Map(); // personId → { events, trips, ratings: Map(orderId → score) }
  function scoreHistory(personId, { firstDay, acceptance, completed, cancelled, onTime, ratings }) {
    const h = { events: [], trips: [], ratings: new Map() };
    h.events.push({ type: 'driver.document_submitted', occurredAt: new Date(now - firstDay * DAY) });
    const rs = rng(personId.length * 97 + firstDay);
    for (let i = 0; i < 90; i++) {
      const at = new Date(now - (0.2 + rs() * Math.min(13.5, firstDay - 0.5)) * DAY);
      h.events.push({ type: rs() < acceptance ? 'trip.accepted' : rs() < 0.6 ? 'trip.declined' : 'trip.timed_out', occurredAt: at });
    }
    for (let i = 0; i < completed + cancelled; i++) {
      const acceptedAt = new Date(now - (0.2 + (i / (completed + cancelled)) * Math.min(firstDay, 44)) * DAY);
      const done = i < completed; // the cancellations are his oldest, before the 14-day window
      const windowEnd = new Date(acceptedAt.getTime() + 25 * 60_000);
      const late = rs() > onTime;
      const arrivedAt = new Date(windowEnd.getTime() + (late ? (5 + rs() * 10) * 60_000 : -rs() * 8 * 60_000));
      const orderId = `demo-score-${personId.slice(-4)}-${i}`;
      if (done && i < 60) h.ratings.set(orderId, ratings[i % ratings.length]);
      h.trips.push({ id: `demo-score-trip-${i}`, state: done ? 'completed' : 'driver_cancelled', acceptedAt, completedAt: done ? new Date(arrivedAt.getTime() + 4 * 60_000) : null, stops: [{ windowEnd, arrivedAt }], orders: [{ orderId }] });
    }
    history.set(personId, h);
  }
  scoreHistory(courier, { firstDay: 64, acceptance: 0.73, completed: 312, cancelled: 2, onTime: 0.75, ratings: [5, 5, 4, 5, 4, 5, 4, 5, 4, 5] });
  scoreHistory(rookie, { firstDay: 8, acceptance: 0.8, completed: 24, cancelled: 0, onTime: 0.85, ratings: [5, 4, 5] });

  const wrap = (target, overrides) =>
    new Proxy(target, {
      get(t, prop) {
        if (prop in overrides) return overrides[prop];
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  const realEvents = account.events;
  account.events = wrap(realEvents, { forActor: async (id) => [...(await realEvents.forActor(id)), ...(history.get(id)?.events ?? [])] });
  const realTrips = account.trips;
  account.trips = wrap(realTrips, { forDriver: async (id) => [...(await realTrips.forDriver(id)), ...(history.get(id)?.trips ?? [])] });
  const realOrders = account.orders;
  account.orders = wrap(realOrders, {
    get: async (orderId) => {
      for (const h of history.values()) {
        const score = h.ratings.get(orderId);
        if (score) return { id: orderId, rating: { delivery: score, ratedAt: new Date(now - DAY) } };
      }
      return realOrders.get(orderId);
    },
  });

  // ── hooks ──────────────────────────────────────────────────────────
  demo.route('/demo/account/fail-next-checkin', async ({ res, query }) => {
    const p = demo.who(query);
    const real = account.submitCheckIn;
    account.submitCheckIn = async (a, input) => {
      if (a.personId !== p.personId) return real.call(account, a, input);
      account.submitCheckIn = real;
      return real.call(account, a, { ...input, livenessScore: 0.2 });
    };
    demo.json(res, 200, { personId: p.personId, failNext: true });
  });
}
