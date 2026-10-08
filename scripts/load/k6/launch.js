// Launch load test (plan §7.1): the customer app, live orders and the kitchens, at launch sizes.
//
//   k6 run -e LOAD_PROFILE=1x -e LOAD_API_URL=https://…/trpc -e LOAD_TOKENS=… -e LOAD_WORLD=… launch.js
//
// Profiles (profiles.js, plan §7.1):
//   smoke  k 0.2, 3 min    — a quick look that the kit and the API agree, not a test row
//   1x     k 1,   2 h      — 0.75 home opens/s, 0.5 menus/s, 0.25 searches/s, 0.25 orders/s,
//                            225 live orders polled, 112 of them with a live-tracking stream
//   2x     k 2,   1 h      — 450 live orders, 250 streams
//   3x     k 3,   15 min   — overload: a 503 is allowed if it is quick and carries Retry-After
// LOAD_K and LOAD_DURATION override the profile's rate and length (prepare.mjs must get the same).
//
// Who does what:
//   visits    an app visit per arrival: home → (a third of visits search) → menu (two thirds) → order
//             (a third: orders.quote → orders.place, cash) and the 2-s wait for the kitchen to accept.
//             Every visit signs in with its own session (see lib.js).
//   live      one virtual user per live order: places one, polls it the way the app does (orders.mine +
//             orders.history every 15 s; orders.track, orders.courierPosition, chat.threads every 30 s)
//             and places another when it ends.
//   streams   the same, with the tracking stream open (live.order over SSE): polls slow to 60 s, as in
//             the app, and the stream is reopened every 10 minutes (a stream token lasts 15).
//   kitchens  one per launch kitchen: heartbeat and board every 30 s, accepts new orders (10 min) and
//             marks them ready when that time is up.
// Couriers and their GPS fixes (20/s at 1×) come with step 2 of the kit.
//
// Setup opens every kitchen all day for the run (and reopens one closed by hand); teardown puts each
// kitchen's hours, closures and hand-closing back.
import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Counter } from 'k6/metrics';
import sse from 'k6/x/sse';
import { BASE, PLAN, customers, merchants, world, query, queryParallel, mutate, session, pick, sleepJitter } from './lib.js';

const homeOpen = new Trend('home_open', true);
const sseConnect = new Trend('sse_connect', true);
const sseOpenFailed = new Counter('sse_open_failed');
const ordersPlaced = new Counter('orders_placed');

// ───────────────────────── sizes ─────────────────────────

const RUN = `${PLAN.durationS}s`;
const GRACE = '2m';

export const options = {
  setupTimeout: '2m',
  teardownTimeout: '2m',
  discardResponseBodies: false,
  scenarios: {
    kitchens: { executor: 'per-vu-iterations', exec: 'kitchen', vus: merchants.length, iterations: 1, maxDuration: RUN, gracefulStop: GRACE },
    ...(PLAN.live > 0 ? { live: { executor: 'per-vu-iterations', exec: 'live', vus: PLAN.live, iterations: 1, maxDuration: RUN, gracefulStop: GRACE } } : {}),
    ...(PLAN.streams > 0 ? { streams: { executor: 'per-vu-iterations', exec: 'stream', vus: PLAN.streams, iterations: 1, maxDuration: RUN, gracefulStop: GRACE } } : {}),
    visits: {
      executor: 'constant-arrival-rate',
      exec: 'visit',
      rate: PLAN.visitsPerMin,
      timeUnit: '1m',
      duration: RUN,
      preAllocatedVUs: Math.ceil(PLAN.visitsPerMin / 2),
      maxVUs: Math.max(20, PLAN.visitsPerMin * 3),
      gracefulStop: GRACE,
    },
  },
  thresholds: PLAN.thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ───────────────────────── setup / teardown ─────────────────────────

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, shifts: [{ start: '00:00', end: '23:59' }] }));

/** A kitchen owner's setup or teardown session (each used once, so never shared with the kitchen's virtual user). */
function setupSession(m, refreshToken) {
  const res = http.post(`${BASE}/identity.refresh?batch=1`, JSON.stringify({ 0: { json: { refreshToken } } }), {
    headers: { 'content-type': 'application/json', 'x-request-id': `load-setup-${m.orgId}` },
    tags: { flow: 'setup' },
  });
  const data = res.status === 200 ? res.json()[0].result.data.json : null;
  if (!data) throw new Error(`setup: could not sign in the owner of ${m.orgId} (HTTP ${res.status}); re-run prepare.mjs`);
  return data;
}

export function setup() {
  if (customers.length < PLAN.sessions) {
    throw new Error(`this run needs ${PLAN.sessions} customer sessions, tokens.json has ${customers.length}: run prepare.mjs with the same profile`);
  }
  const kitchens = [];
  for (const m of merchants) {
    const auth = setupSession(m, m.setupToken);
    const hours = query('setup', auth.accessToken, [['merchant.hours', { merchantOrgId: m.orgId }]]).data[0];
    if (!hours) throw new Error(`setup: could not read the hours of ${m.orgId}`);
    mutate('setup', auth.accessToken, 'merchant.setHours', { merchantOrgId: m.orgId, days: ALL_DAY, holidays: [] });
    const status = query('setup', auth.accessToken, [['merchant.storeStatus', { merchantOrgId: m.orgId }]]).data[0];
    if (status && status.closed) mutate('setup', auth.accessToken, 'merchant.setOpen', { merchantOrgId: m.orgId, open: true });
    // Setup data ends up in k6's summary file: hours and closure only, never a token.
    kitchens.push({ orgId: m.orgId, days: hours.days, holidays: hours.holidays, closed: status && status.closed ? { reason: status.closed.reason, note: status.closed.note } : null });
  }
  console.log(`load ${PLAN.name}: k ${PLAN.k}, ${PLAN.durationS} s, ${PLAN.visitsPerMin} visits/min, ${PLAN.live} live orders + ${PLAN.streams} with a stream, ${merchants.length} kitchens open all day for the run`);
  return { kitchens };
}

export function teardown(data) {
  for (const k of data.kitchens) {
    const m = merchants.find((x) => x.orgId === k.orgId);
    const auth = setupSession(k, m.teardownToken);
    // A kitchen whose hours came from its catalog keeps the same days, now saved as its own.
    mutate('setup', auth.accessToken, 'merchant.setHours', { merchantOrgId: k.orgId, days: k.days, holidays: k.holidays });
    if (k.closed) mutate('setup', auth.accessToken, 'merchant.setOpen', { merchantOrgId: k.orgId, open: false, reason: k.closed.reason, ...(k.closed.note ? { note: k.closed.note } : {}) });
  }
}

// ───────────────────────── customer flows ─────────────────────────

const PICK_WORDS = ['تكة', 'كباب', 'شاورما', 'دولمة', 'باچة', 'قوزي', 'كص'];
const SEARCHES = ['كباب', 'تكة', 'شاورما', 'دولمة', 'شوربة', 'عصير', 'سلطة', 'باچة', 'قيمر', 'كبة'];
const DONE = new Set(['closed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed', 'delivered', 'completed', 'disputed']);

const dropoff = () => pick(world.dropoffs);

/** The home screen: the app's queries leave in two batches at once (its URL-length split). */
function home(token, where) {
  const out = queryParallel('home', token, [
    [
      ['orders.mine', null],
      ['orders.history', null],
      ['orders.usuals', null],
      ['catalog.dishFollows', null],
      ['notify.myLaunchInterests', null],
      ['rideHabits.dinnerChance', null],
    ],
    [
      ['catalog.restaurants', { cityId: world.cityId, dropoff: where, filters: {} }],
      ['catalog.picks', { cityId: world.cityId, words: [pick(PICK_WORDS), pick(PICK_WORDS)], limit: 3, dropoff: where }],
      ['catalog.pots', { cityId: world.cityId, dropoff: where }],
      ['system.season', { cityId: world.cityId }],
      ['system.banner', { app: 'customer', cityId: world.cityId }],
    ],
  ]);
  homeOpen.add(Math.max(...out.map((o) => o.res.timings.duration)));
}

/**
 * Launch-night customers are new: their first three cash orders are capped at 25,000 دينار with fees
 * (money rules, newCustomerCash), so baskets stay at 20,000 or less, as the app's cart would.
 */
const BASKET_MAX_IQD = 20_000;

function orderInput(where) {
  const k = pick(world.kitchens);
  const n = 1 + Math.floor(Math.random() * 3);
  const lines = [];
  let sum = 0;
  for (let i = 0; i < n * 3 && lines.length < n; i++) {
    const d = pick(k.dishes);
    const qty = 1 + Math.floor(Math.random() * 2);
    if (lines.some((l) => l.catalogItemId === d.id) || sum + d.priceIqd * qty > BASKET_MAX_IQD) continue;
    sum += d.priceIqd * qty;
    lines.push({ catalogItemId: d.id, qty, unitPriceIqd: d.priceIqd, modifiers: [], merchantOrgId: k.id });
  }
  if (lines.length === 0) {
    const d = k.dishes.reduce((a, b) => (b.priceIqd < a.priceIqd ? b : a));
    lines.push({ catalogItemId: d.id, qty: 1, unitPriceIqd: d.priceIqd, modifiers: [], merchantOrgId: k.id });
  }
  return {
    cityId: world.cityId,
    type: 'food',
    merchantOrgId: k.id,
    lines,
    participants: [],
    tipIqd: 0,
    options: { streetHandover: false },
    paymentMethod: 'cash',
    dropoff: where,
  };
}

let placeSeq = 0;
/** Basket → orders.quote → orders.place, as the checkout sends it. Returns the order or null. */
function placeOrder(token, where) {
  const input = orderInput(where);
  query('quote', token, [['orders.quote', input]]);
  placeSeq += 1;
  const placed = mutate('place', token, 'orders.place', { ...input, clientRequestId: `load_${exec.vu.idInTest}_${placeSeq}_${Date.now().toString(36)}` });
  if (placed.data) ordersPlaced.add(1);
  return placed.data;
}

/** The order screen polls orders.get every 2 s while the kitchen hasn't answered (up to its 90 s window). */
function waitForKitchen(token, orderId) {
  const until = Date.now() + 100_000;
  while (Date.now() < until) {
    sleep(2);
    const o = query('order_wait', token, [['orders.get', { orderId }]]).data[0];
    if (!o || o.state !== 'placed') return;
  }
}

export function visit() {
  const me = session('customer', PLAN.offsets.visits + exec.scenario.iterationInTest);
  const token = me.token();
  const where = dropoff();
  home(token, where);
  sleep(sleepJitter(4));
  if (Math.random() < 1 / 3) {
    query('search', token, [['catalog.search', { cityId: world.cityId, query: pick(SEARCHES), dropoff: where }]]);
    sleep(sleepJitter(3));
  }
  if (Math.random() < 2 / 3) {
    const kitchen = pick(world.kitchens);
    query('menu', token, [['catalog.menu', { merchantId: kitchen.id, dropoff: where }]]);
    sleep(sleepJitter(10));
    // Half of the menu visits order: a third of all visits, 0.25 orders/s at 1×.
    if (Math.random() < 0.5) {
      const order = placeOrder(token, where);
      if (order) waitForKitchen(token, order.id);
    }
  }
}

const endsAt = () => exec.scenario.startTime + PLAN.durationS * 1000 - 5_000;

/** A customer with an order on the way: one is placed at a random moment in the first two minutes. */
function liveOrder(me, where) {
  const order = placeOrder(me.token(), where);
  if (order) waitForKitchen(me.token(), order.id);
  return order;
}

function pollFrequent(token) {
  query('active_mine', token, [['orders.mine', null], ['orders.history', null]]);
}

/** Returns the order's state (null when the read failed). */
function pollTracking(token, orderId) {
  const out = query('active_track', token, [
    ['orders.track', { orderId }],
    ['orders.courierPosition', { orderId }],
    ['chat.threads', { orderId }],
  ]);
  const t = out.data[0];
  return t && t.order ? t.order.state : null;
}

export function live() {
  const me = session('customer', PLAN.offsets.live + exec.scenario.iterationInTest);
  sleep(Math.random() * Math.min(120, PLAN.durationS / 4));
  const where = dropoff();
  let order = liveOrder(me, where);
  let tick = 0;
  while (Date.now() < endsAt()) {
    sleep(15);
    tick += 1;
    const token = me.token();
    pollFrequent(token);
    if (order && tick % 2 === 0) {
      const state = pollTracking(token, order.id);
      if (state && DONE.has(state)) order = liveOrder(me, where);
    } else if (!order && tick % 4 === 0) {
      order = liveOrder(me, where);
    }
  }
}

export function stream() {
  const me = session('customer', PLAN.offsets.streams + exec.scenario.iterationInTest);
  sleep(Math.random() * Math.min(120, PLAN.durationS / 4));
  const where = dropoff();
  let order = liveOrder(me, where);
  while (Date.now() < endsAt()) {
    if (!order) {
      sleep(30);
      order = liveOrder(me, where);
      continue;
    }
    const token = me.token();
    const live = mutate('stream_token', token, 'live.token', null).data;
    if (!live) {
      sleep(15);
      continue;
    }
    const url = `${BASE}/live.order?input=${encodeURIComponent(JSON.stringify({ json: { orderId: order.id } }))}&connectionParams=${encodeURIComponent(JSON.stringify({ streamToken: live.token }))}`;
    const started = Date.now();
    const closeAt = Math.min(started + 10 * 60_000, endsAt());
    let pings = 0;
    let ended = false;
    const res = sse.open(url, { tags: { flow: 'stream' } }, (client) => {
      client.on('open', () => sseConnect.add(Date.now() - started));
      client.on('event', (e) => {
        // The API pings every 15 s: the app's polls ride on that clock (k6 timers wait while a stream is open).
        if (e.name !== 'ping') return;
        pings += 1;
        const t = me.token();
        pollFrequent(t);
        if (pings % 4 === 0) {
          const state = pollTracking(t, order.id);
          if (state && DONE.has(state)) ended = true;
        }
        if (ended || Date.now() >= closeAt) client.close();
      });
      client.on('error', () => {});
    });
    if (!res || res.status !== 200) {
      sseOpenFailed.add(1, { status: String(res ? res.status : 0) });
      sleep(5);
    }
    if (ended) order = liveOrder(me, where);
  }
}

// ───────────────────────── kitchens ─────────────────────────

const PREP_MINUTES = 10;

export function kitchen(data) {
  const idx = exec.scenario.iterationInTest;
  const me = session('merchant', idx);
  const orgId = me.orgId;
  while (Date.now() < endsAt()) {
    const token = me.token();
    mutate('kitchen_heartbeat', token, 'orders.merchant.heartbeat', { merchantOrgId: orgId });
    const board = query('kitchen_board', token, [['merchant.board', { merchantOrgId: orgId }]]).data[0];
    const now = Date.now();
    for (const o of board ? board.orders : []) {
      if (o.column === 'new' && o.state === 'placed') {
        mutate('kitchen_accept', token, 'orders.merchant.accept', { orderId: o.id, prepMinutes: PREP_MINUTES, unavailableLineIds: [] }, [409]);
      } else if (o.column === 'preparing' && o.promisedReadyAt && Date.parse(o.promisedReadyAt) <= now) {
        mutate('kitchen_ready', token, 'orders.merchant.ready', { orderId: o.id }, [409]);
      }
    }
    sleep(30);
  }
}
