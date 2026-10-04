// Three-app end-to-end walk on ONE in-memory API (the built apps/api/dist, no Postgres/Redis).
//
//   pnpm turbo run build --filter='./packages/*' && pnpm --filter @driver/api build
//   node scripts/e2e/three-apps.mjs                      # all flows, API assertions only
//   FLOWS=food,rajaa,ride node scripts/e2e/three-apps.mjs
//   KEEP=1 node scripts/e2e/three-apps.mjs               # keep the API up on :3340 afterwards
//   LIVE=0 node scripts/e2e/three-apps.mjs               # skip the real-time (live.* over SSE) checks
//
// Screenshots of the same order in each app at every step (optional): export the three web builds
// against http://127.0.0.1:3340/trpc into apps/<app>/dist-e2e, then
//   SHOTS_DIR=/tmp/shots PLAYWRIGHT_MODULE=…/playwright/index.mjs CHROMIUM_PATH=…/chrome \
//     node scripts/e2e/three-apps.mjs
//
// Unlike the apps' demo-api.mjs scripts nothing here injects state behind the apps' backs: the
// script seeds people, roles, stores and the courier's vehicle (what onboarding and ops do), then
// every step of every flow goes through the same tRPC procedures the apps call, signed in as the
// person who would tap the button. After each step it reads what each app reads (orders.track for
// the customer, merchant.board + ledger.merchantBalance for the kitchen, partner.* for the courier)
// and asserts they agree.
//
// Real time (on unless LIVE=0): the customer, the kitchen and the courier also hold their live.*
// streams (tRPC subscriptions over SSE, stream token in connection params — what the apps do), and
// the food flow asserts the events arrive: the kitchen's new_order ring, the customer's order states
// and courier positions, the courier's offer and job invalidations.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const apiDir = join(root, 'apps/api');
const requireFromApi = createRequire(join(apiDir, 'package.json'));
const requireFromApp = createRequire(join(root, 'apps/customer/package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);
const fromApp = (id) => import(pathToFileURL(requireFromApp.resolve(id)).href);

// Many sign-ins from one address in a few seconds: lift the per-IP/device OTP limits for this run.
process.env.OTP_RATE_LIMIT_PER_IP_HOUR ??= '10000';
process.env.OTP_RATE_LIMIT_PER_DEVICE_HOUR ??= '10000';

const PORT = Number(process.env.PORT ?? 3340);
const BASE = `http://127.0.0.1:${PORT}`;
const FLOWS = new Set((process.env.FLOWS ?? 'food,rajaa,ride').split(',').map((s) => s.trim()).filter(Boolean));
const CITY = 'aziziyah';

const { createTRPCClient, httpBatchLink, httpSubscriptionLink } = await fromApp('@trpc/client');
const contracts = await fromApp('@driver/contracts');
const LIVE = process.env.LIVE !== '0';
const liveClient = LIVE ? await fromApp('@driver/contracts/live-client') : null;
const { transformer, deliveryFeesOf } = contracts;

// ───────────────────────── assertions ─────────────────────────

const results = [];
let currentFlow = 'setup';
let failures = 0;
function check(cond, what, detail) {
  results.push({ flow: currentFlow, ok: Boolean(cond), what });
  if (cond) console.log(`  ✔ ${what}`);
  else {
    failures += 1;
    console.log(`  ✘ ${what}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
  return Boolean(cond);
}
const step = (name) => console.log(`\n[${currentFlow}] ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 15_000, everyMs = 250 } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

// ───────────────────────── API ─────────────────────────

const { createApp } = await load('bootstrap.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService, seedStorefronts } = await load('modules/catalog/index.js');
const { IdentityService } = await load('modules/identity/index.js');
const { COURIER_VEHICLES } = await load('modules/tracking/index.js');

const app = await createApp();
await app.init();
const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const identity = app.get(IdentityService);
const vehicles = app.get(COURIER_VEHICLES);
await app.listen(PORT);
console.log(`E2E API up at ${BASE}/trpc`);

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
const anon = createTRPCClient({ links: [httpBatchLink({ url: `${BASE}/trpc`, transformer })] });

/** A person signed in through the real OTP flow (dev code), with a client carrying their token. */
async function signIn(phone, { name, roles = [], orgRoles = [], vehicle } = {}) {
  await anon.identity.requestOtp.mutate({ phone });
  const { code } = await anon.identity.devLastOtp.query({ phone });
  const out = await anon.identity.verifyOtp.mutate({ phone, code, device: { fingerprint: `e2e-${phone}-device`, platform: 'web' } });
  const personId = out.personId;
  for (const kind of roles) await identity.grantRole(SYSTEM, { personId, kind });
  for (const r of orgRoles) await identity.grantRole(SYSTEM, { personId, kind: r.kind, orgId: r.orgId });
  if (vehicle) vehicles.register?.(personId, vehicle);
  const api = createTRPCClient({ links: [httpBatchLink({ url: `${BASE}/trpc`, transformer, headers: { authorization: `Bearer ${out.tokens.accessToken}` } })] });
  if (name) await api.identity.updateProfile.mutate({ name });
  // The apps' subscription link: SSE (Node has no EventSource: the fetch ponyfill), stream token in connection params.
  let live = null;
  if (liveClient) {
    const streamTokens = liveClient.createStreamTokenCache(() => api.live.token.mutate());
    live = createTRPCClient({
      links: [httpSubscriptionLink({ url: `${BASE}/trpc`, transformer, EventSource: liveClient.createFetchEventSource(), connectionParams: async () => ({ streamToken: await streamTokens.get() }) })],
    });
  }
  return { personId, phone, tokens: out.tokens, api, live };
}

/** An open live.* stream: the events so far and a waiter (resolves null on timeout). */
const taps = [];
function tap(label, subscribe) {
  const events = [];
  let error = null;
  const sub = subscribe({
    onData: (e) => events.push({ ...e, receivedAt: Date.now() }),
    onError: (err) => (error = err),
    onComplete: () => undefined,
  });
  const t = {
    label,
    events,
    get error() {
      return error;
    },
    /** First event after `from` (index) matching `pred`, or null after `timeoutMs`. */
    async next(pred, { timeoutMs = 5000, from = 0 } = {}) {
      return until(() => events.slice(from).find(pred) ?? null, { timeoutMs, everyMs: 25 });
    },
    mark: () => events.length,
    close: () => sub.unsubscribe(),
  };
  taps.push(t);
  return t;
}

/** The daily selfie check-in, the way the Partner app does it: challenge → photo upload → submit. */
async function dailyCheckIn(p) {
  const status = await p.api.partner.status.query();
  if (!status.gate || status.gate.canGoOnline) return true;
  const challenge = await p.api.driverAccount.checkInChallenge.mutate();
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const ticket = await p.api.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: jpeg.length });
  const url = /^https?:/.test(ticket.uploadUrl) ? ticket.uploadUrl : `${BASE}${ticket.uploadUrl}`;
  const put = await fetch(url, { method: 'PUT', headers: ticket.headers, body: jpeg });
  if (!put.ok) throw new Error(`selfie upload ${put.status}`);
  const res = await p.api.driverAccount.submitCheckIn.mutate({ challengeId: challenge.challengeId, uploadId: ticket.uploadId });
  return res.result === 'passed';
}

// ───────────────────────── seed (what onboarding / ops do) ─────────────────────────

// The launch seed, with every kitchen open around the clock so the walk runs at any hour.
const { AZIZIYAH_RESTAURANTS } = await fromApp('@driver/contracts/seeds');
const allDay = AZIZIYAH_RESTAURANTS.map((r) => ({ ...r, hours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: '00:00', end: '23:59' })) }));
const seeded = await seedStorefronts(orgs, catalog, allDay, 'e2e-owner');
await orgs.settled?.();
const khalid = seeded.find((s) => s.seed.key === 'khalid');
const KHALID_PIN = khalid.seed.pin;
const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };

const people = {
  customer: await signIn('07801112233', { name: 'علي حسن' }),
  owner: await signIn('07701234567', { name: 'خالد', orgRoles: [{ kind: 'merchant_owner', orgId: khalid.orgId }] }),
  staff: await signIn('07709990000', { name: 'مصطفى', orgRoles: [{ kind: 'merchant_staff', orgId: khalid.orgId }] }),
  courier: await signIn('07701110001', { name: 'حيدر كاظم', roles: ['courier'], vehicle: { vehicleClass: 'bike', plate: 'واسط 45678', label: null } }),
  intercity: await signIn('07701110003', { name: 'جاسم محمد', roles: ['intercity_driver'] }),
  tuktuk: await signIn('07701110002', { name: 'عباس فاضل', roles: ['driver'], vehicle: { vehicleClass: 'tuktuk', plate: 'واسط 31207', label: null } }),
};

// ───────────────────────── optional screenshots ─────────────────────────

const shots = await (async () => {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return null;
  const { setupShots } = await import(pathToFileURL(join(root, 'scripts/e2e/shots.mjs')).href);
  return setupShots({ root, dir, apiBase: BASE, people, existsSync, mkdirSync, readFileSync, createServer, extname, join });
})();
const capture = async (name, views) => {
  if (shots) await shots.capture(name, views);
};

// ───────────────────────── flow 1: food, cash, grouped by person ─────────────────────────

async function foodFlow() {
  currentFlow = 'food';
  const { customer, owner, staff, courier } = people;
  const board = async () => (await staff.api.merchant.board.query({ merchantOrgId: khalid.orgId }));
  const cardOf = async (orderId) => {
    const hit = (await board()).orders.find((o) => o.id === orderId);
    return hit ? { column: hit.column, card: hit } : null;
  };
  const track = (orderId) => customer.api.orders.track.query({ orderId });

  step('customer: home place, restaurant list, menu, quote');
  const place = await customer.api.places.save.mutate({ cityId: CITY, label: 'home', name: 'البيت', pin: HOME.pin, note: 'باب أخضر يم الجامع' });
  check(place.zoneId === HOME.zoneKey, `home place resolves to zone ${HOME.zoneKey}`, place.zoneId);
  const cards = await customer.api.catalog.restaurants.query({ cityId: CITY, dropoff: HOME, filters: {} });
  const card = cards.find((c) => c.id === khalid.orgId);
  check(card, 'مطعم خالد is on the customer home rail (catalog.restaurants)');
  console.log(`  · card: open=${card?.open} closedReason=${card?.closedReason} fee=${card?.deliveryFeeIqd} eta=${card?.etaMinMinutes}-${card?.etaMaxMinutes}`);
  const menu = await customer.api.catalog.menu.query({ merchantId: khalid.orgId, dropoff: HOME });
  const items = menu.categories.flatMap((c) => c.items).filter((i) => i.available && !i.modifierGroups.some((g) => g.required));
  // Two real dishes (no drinks), under the new-customer cash cap with the fees.
  const dishes = items.filter((i) => i.priceIqd >= 1000 && i.priceIqd <= 9000).sort((a, b) => b.priceIqd - a.priceIqd);
  const [cheap, second] = dishes;
  check(cheap && second, 'menu has orderable dishes without required choices', items.length);
  const quote = await customer.api.pricing.quote.query({
    cityId: CITY,
    vertical: 'food',
    stops: [
      { zoneId: card.pickup.zoneKey, type: 'pickup', pin: card.pickup.pin ?? KHALID_PIN },
      { zoneId: HOME.zoneKey, type: 'dropoff', pin: HOME.pin },
    ],
    options: { streetHandover: false, doorPickup: false },
    at: new Date(),
  });
  const fees = deliveryFeesOf(quote);
  console.log(`  · ${cheap?.name} ${cheap?.priceIqd} + ${second?.name} ${second?.priceIqd}; fees ${JSON.stringify(fees)}`);

  let kitchenLive = null;
  if (LIVE) {
    step('live: the kitchen opens its board stream (live.merchantBoard)');
    kitchenLive = tap('kitchen', (h) => staff.live.live.merchantBoard.subscribe({ merchantOrgId: khalid.orgId }, h));
    check(await kitchenLive.next((e) => e.type === 'hello'), 'live.merchantBoard: hello (stream token accepted, store scope checked)', kitchenLive.error?.message);
  }

  step('customer places a cash order for two people (orders.place)');
  const placedAt = Date.now();
  const order = await customer.api.orders.place.mutate({
    cityId: CITY,
    type: 'food',
    merchantOrgId: khalid.orgId,
    lines: [
      { catalogItemId: cheap.id, qty: 1, unitPriceIqd: cheap.priceIqd, modifiers: [], merchantOrgId: khalid.orgId },
      { catalogItemId: second.id, qty: 1, unitPriceIqd: second.priceIqd, modifiers: [], participantRef: 'ahmed', note: 'بدون بصل', merchantOrgId: khalid.orgId },
    ],
    participants: [{ ref: 'ahmed', role: 'diner', label: 'أحمد' }],
    deliveryFeeIqd: fees.deliveryFeeIqd,
    serviceFeeIqd: fees.serviceFeeIqd,
    tipIqd: 0,
    options: { streetHandover: false },
    paymentMethod: 'cash',
    dropoff: HOME,
    note: 'اتصل من توصل',
  });
  const orderId = order.id;
  check(order.state === 'placed', `order placed (${orderId}), total ${order.totalIqd}`, order.state);
  // Ali's rounding (2026-10-04): a cash total is the price rounded up to 250; the remainder is change
  // credited to the wallet ("الباقي رصيد"), never a charge.
  const price = cheap.priceIqd + second.priceIqd + fees.deliveryFeeIqd + fees.serviceFeeIqd;
  check(order.totalIqd === Math.ceil(price / 250) * 250 && (order.changeIqd ?? 0) === order.totalIqd - price, `server total = items + quoted fees, cash rounded up to 250 (price ${price}, change ${order.changeIqd ?? 0})`);

  let customerLive = null;
  if (LIVE) {
    const ring = await kitchenLive.next((e) => e.type === 'new_order' && e.orderId === orderId);
    check(ring, `live: the kitchen's new_order ring arrives (${ring ? ring.receivedAt - placedAt : '?'} ms after place)`);
    customerLive = tap('customer', (h) => customer.live.live.order.subscribe({ orderId }, h));
    check(await customerLive.next((e) => e.type === 'hello'), 'live.order: hello for the customer (orders.track scope)', customerLive.error?.message);
    const stranger = tap('stranger', (h) => people.owner.live.live.order.subscribe({ orderId }, h));
    await until(() => stranger.error, { timeoutMs: 3000 });
    check(stranger.error?.data?.code === 'forbidden' && !stranger.events.length, 'live.order: someone else cannot open this order\'s stream (forbidden)', stranger.error?.data?.code);
  }
  let t = await track(orderId);
  check(t.order.state === 'placed' && !t.courier, 'customer tracking: waiting for the kitchen, no courier yet');
  let c = await until(() => cardOf(orderId), { timeoutMs: 5000 });
  check(c?.column === 'new', 'merchant board: order in the "new" column', c?.column);
  const groups = c?.card.groups ?? [];
  check(groups.length === 2 && groups[0].kind === 'orderer' && groups[1].label === 'أحمد', 'merchant board: lines grouped by person (orderer, then أحمد)', groups.map((g) => g.label ?? g.kind));
  check(groups[1]?.lines?.[0]?.note === 'بدون بصل', 'merchant board: أحمد\'s line note shows');
  check(c?.card.collectCashIqd === order.totalIqd, 'merchant board: cash to collect = order total', c?.card.collectCashIqd);
  const balanceBefore = (await owner.api.ledger.merchantBalance.query({ merchantId: khalid.orgId })).balanceIqd;

  step('courier: daily check-in, goes online near the kitchen');
  check(await dailyCheckIn(courier), 'daily selfie check-in passes (driverAccount.checkInChallenge → submitCheckIn)');
  const online = await courier.api.partner.goOnline.mutate({ cityId: CITY, at: { lat: KHALID_PIN.lat + 0.004, lng: KHALID_PIN.lng - 0.003 }, vehicleClass: 'bike' });
  check(online.online, 'partner.goOnline: online');
  const cashBefore = online.cash.heldIqd;
  check((await courier.api.partner.currentOffer.query()) === null, 'partner: no offer before the kitchen accepts');
  let courierLive = null;
  if (LIVE) {
    courierLive = tap('courier', (h) => courier.live.live.partner.subscribe(undefined, h));
    check(await courierLive.next((e) => e.type === 'hello' && e.channels[0] === `driver:${courier.personId}`), 'live.partner: hello on his own channel', courierLive.error?.message);
  }
  await capture('1-placed', { customer: `/order/${orderId}`, merchant: '/', partner: '/' });

  step('kitchen accepts with 15 min prep (orders.merchant.accept)');
  const acceptMark = customerLive?.mark() ?? 0;
  const accepted = await staff.api.orders.merchant.accept.mutate({ orderId, prepMinutes: 15 });
  check(accepted.state === 'merchant_accepted', 'order accepted', accepted.state);
  if (LIVE) {
    check(await customerLive.next((e) => e.type === 'order_state' && e.state === 'merchant_accepted', { from: acceptMark }), 'live: the customer gets order_state merchant_accepted');
    check(await customerLive.next((e) => e.type === 'invalidate' && e.keys.includes('orders.track'), { from: acceptMark }), 'live: … and an orders.track invalidation');
  }
  c = await cardOf(orderId);
  check(c?.column === 'preparing', 'merchant board: moved to "preparing"', c?.column);
  t = await track(orderId);
  check(['merchant_accepted', 'preparing'].includes(t.order.state) && t.promisedAt, 'customer tracking: accepted with a promised time', { state: t.order.state, promisedAt: t.promisedAt });
  check(c?.card.courier?.state === 'searching' || c?.card.courier?.state === 'none', 'merchant board: courier "searching"', c?.card.courier);
  const early = await courier.api.partner.currentOffer.query();
  console.log(`  · offer right after accept: ${early ? 'yes' : 'no (scheduled for ready − ETA − 2 min)'}`);
  await capture('2-accepted', { customer: `/order/${orderId}`, merchant: '/', partner: '/' });

  step('kitchen marks ready early → courier offer goes out now');
  const readyMark = courierLive?.mark() ?? 0;
  const ready = await staff.api.orders.merchant.ready.mutate({ orderId });
  check(ready.state === 'ready', 'order ready', ready.state);
  c = await cardOf(orderId);
  check(c?.column === 'ready', 'merchant board: moved to "ready"', c?.column);
  const offer = await until(() => courier.api.partner.currentOffer.query(), { timeoutMs: 8000 });
  check(offer, 'partner.currentOffer: the courier gets the offer');
  if (LIVE) check(await courierLive.next((e) => e.type === 'invalidate' && e.keys.includes('partner.currentOffer'), { from: readyMark }), 'live: the courier is told to re-read his offer (dispatch.offer_sent)');
  if (!offer) return;
  check(offer.vertical === 'food' && offer.pickup.label === khalid.seed.nameAr, `offer: food pickup at ${offer.pickup.label}`);
  check(offer.collectIqd === order.totalIqd, 'offer: cash to collect = order total', offer.collectIqd);
  check(offer.pay.totalIqd > 0, `offer: named pay ${offer.pay.components?.map((p) => `${p.key}=${p.amountIqd}`).join(', ')}`);
  await capture('3-offer', { partner: '@current', customer: `/order/${orderId}`, merchant: '/', order: ['partner', 'customer', 'merchant'] });

  step('courier accepts (dispatch.respond)');
  const resp = await courier.api.dispatch.respond.mutate({ offerId: offer.offerId, accept: true });
  check(resp.outcome === 'assigned', 'dispatch.respond: assigned', resp.outcome);
  let job = await courier.api.partner.activeJob.query();
  check(job && job.tripId === offer.tripId, 'partner.activeJob: the job is his');
  const pickup = job?.stops.find((s) => s.type === 'pickup');
  const drop = job?.stops.find((s) => s.type === 'dropoff');
  check(pickup && drop, 'job has a pickup and a drop-off stop');
  await courier.api.trips.reportPosition.mutate({ pin: { lat: KHALID_PIN.lat + 0.003, lng: KHALID_PIN.lng - 0.002 }, at: new Date(), speedKmh: 20, bearing: 150 });
  c = await cardOf(orderId);
  check(c?.card.courier?.state === 'on_the_way' && c.card.courier.firstName === 'حيدر', 'merchant board: courier حيدر on the way', c?.card.courier);
  check(c?.card.courier?.etaMinutes != null, 'merchant board: courier minutes to the counter (from his live position)', c?.card.courier?.etaMinutes);
  t = await track(orderId);
  check(t.courier?.firstName === 'حيدر', 'customer tracking: courier card shows حيدر', t.courier);
  const pos = await customer.api.orders.courierPosition.query({ orderId });
  check(pos, 'customer tracking: courier position visible on the map', pos);
  if (LIVE) {
    const fix = await customerLive.next((e) => e.type === 'position' && e.orderId === orderId);
    check(fix && Math.abs(fix.pin.lat - (KHALID_PIN.lat + 0.003)) < 1e-9, 'live: the courier position is pushed to the customer', fix?.pin);
  }
  await capture('4-courier-assigned', { customer: `/order/${orderId}`, merchant: '/', partner: '/job' });

  step('courier at the kitchen, picks up');
  await courier.api.trips.reportPosition.mutate({ pin: KHALID_PIN, at: new Date(), speedKmh: 0 });
  await courier.api.trips.arrive.mutate({ tripId: job.tripId, stopId: pickup.stopId, pin: KHALID_PIN, occurredAt: new Date() });
  c = await cardOf(orderId);
  check(c?.card.courier?.state === 'arrived', 'merchant board: "الدليفري وصل"', c?.card.courier?.state);
  await capture('5-at-kitchen', { customer: `/order/${orderId}`, merchant: '/', partner: '/job' });
  await courier.api.trips.completeStop.mutate({ tripId: job.tripId, stopId: pickup.stopId, handover: {}, occurredAt: new Date() });
  t = await track(orderId);
  check(t.order.state === 'picked_up', 'customer tracking: picked up / on the way', t.order.state);
  c = await cardOf(orderId);
  check(!c, 'merchant board: order left the board after pickup');
  job = await courier.api.partner.activeJob.query();
  check(job?.stops.find((s) => s.stopId === job.currentStopId)?.type === 'dropoff', 'partner job: current stop is the drop-off');
  await courier.api.trips.reportPosition.mutate({ pin: { lat: 32.8961, lng: 45.0709 }, at: new Date(), speedKmh: 25, bearing: 140 });
  await capture('6-on-the-way', { customer: `/order/${orderId}`, merchant: '/', partner: '/job' });

  step('courier at the door, collects cash');
  await courier.api.trips.reportPosition.mutate({ pin: HOME.pin, at: new Date(), speedKmh: 0 });
  await courier.api.trips.arrive.mutate({ tripId: job.tripId, stopId: drop.stopId, pin: HOME.pin, occurredAt: new Date() });
  job = await courier.api.partner.activeJob.query();
  const dropView = job?.stops.find((s) => s.stopId === drop.stopId);
  check(dropView?.collectIqd === order.totalIqd, `partner job: "استلمت ${order.totalIqd} دينار" at the door`, dropView?.collectIqd);
  t = await track(orderId);
  check(t.trip?.state === 'arrived_dropoff' || t.trip?.stops?.some?.((s) => s.type === 'dropoff' && s.state === 'arrived'), 'customer tracking: courier at the door', t.trip?.state);
  await capture('7-at-door', { customer: `/order/${orderId}`, merchant: '/', partner: '/job' });
  await courier.api.trips.completeStop.mutate({ tripId: job.tripId, stopId: drop.stopId, handover: { cashCollectedIqd: order.totalIqd }, occurredAt: new Date() });
  t = await track(orderId);
  check(t.order.state === 'delivered', 'customer tracking: delivered', t.order.state);
  if (LIVE) {
    check(await customerLive.next((e) => e.type === 'order_state' && e.state === 'delivered'), 'live: the customer gets order_state delivered');
    check(await courierLive.next((e) => e.type === 'invalidate' && e.keys.includes('partner.status')), 'live: the courier is told his cash/earnings moved (partner.status)');
    for (const x of [kitchenLive, customerLive, courierLive]) x.close();
  }

  step('money: merchant cash balance and courier cash held');
  const bal = await until(async () => {
    const b = await owner.api.ledger.merchantBalance.query({ merchantId: khalid.orgId });
    return b.balanceIqd !== balanceBefore ? b : null;
  }, { timeoutMs: 5000 });
  check(bal && bal.balanceIqd > balanceBefore, `merchant cash balance rises (${balanceBefore} → ${bal?.balanceIqd})`);
  check(bal?.holders?.some((h) => h.courierId === courier.personId && h.amountIqd > 0), 'merchant balance: حيدر listed as holding our cash', bal?.holders);
  const status = await until(async () => {
    const s = await courier.api.partner.status.query();
    return s.cash.heldIqd > cashBefore ? s : null;
  }, { timeoutMs: 5000 });
  check(status && status.cash.heldIqd - cashBefore === order.totalIqd, `partner: cash held rises by the order total (${cashBefore} → ${status?.cash.heldIqd})`);
  check(status?.today.jobs >= 1 && status.today.earningsIqd > 0, `partner: today's earnings ${status?.today.earningsIqd} from ${status?.today.jobs} job(s)`);
  check((await courier.api.partner.activeJob.query()) === null, 'partner: no active job after the drop-off');
  await capture('8-delivered', { customer: `/order/${orderId}`, merchant: '/money', partner: '/' });

  step('customer rates');
  const rated = await customer.api.orders.rate.mutate({ orderId, delivery: 5, food: 4 });
  check(rated.rating?.delivery === 5, 'orders.rate stored', rated.rating);
  const mine = await customer.api.orders.mine.query();
  check(mine.some((o) => o.id === orderId), 'customer orders tab lists the order (orders.mine)');
  await courier.api.partner.goOffline.mutate({});
  return orderId;
}

// ───────────────────────── flow 2: الرجعة seat ─────────────────────────

const jpegBytes = () => Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

async function rajaaFlow() {
  currentFlow = 'rajaa';
  const { customer, intercity } = people;
  const GARAGE = 'mp_garage_nahdha';
  const CORRIDOR = 'aziziyah_baghdad';
  const garagePin = { lat: 33.3344, lng: 44.4165 };

  step('driver announces a car from كراج النهضة (routes.driver.announce)');
  const network = await intercity.api.routes.network.query();
  check(JSON.stringify(network).includes(GARAGE), 'network lists كراج النهضة');
  // 45+ min ahead: the T−30 low-fill check (< 3 seats → cancelled) must not fire mid-walk.
  const departAt = new Date(Math.ceil((Date.now() + 45 * 60_000) / 900_000) * 900_000);
  const dep = await intercity.api.routes.driver.announce.mutate({
    garageId: GARAGE,
    corridorId: CORRIDOR,
    departAt,
    latestDepartureAt: new Date(departAt.getTime() + 40 * 60_000),
    vehicle: { kind: 'saloon', layout: 4, plate: '12345 بغداد', model: 'كامري', color: 'بيضاء' },
  });
  check(dep.id && dep.direction === 'to_aziziyah', `departure ${dep.id} announced, direction ${dep.direction}`);
  await capture('r1-announced', { customer: '/rajaa', partner: `/intercity/departure/${dep.id}`, partnerAs: 'intercity' });

  step('customer finds it on the الرجعة board and books the front seat (cash)');
  const board = await customer.api.routes.board.query({ corridorId: CORRIDOR, direction: 'to_aziziyah', travellingAs: 'rijal' });
  check(JSON.stringify(board).includes(dep.id), 'customer board shows the departure');
  const hold = await customer.api.routes.holdSeat.mutate({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['front'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
  check(hold.state === 'held', `seat held (${hold.id}) for 10 minutes`, hold.state);
  const booked = await customer.api.routes.bookSeat.mutate({ bookingId: hold.id, payment: 'cash' });
  check(booked.state === 'booked', 'seat booked, cash reservation', booked.state);
  const pass = await customer.api.routes.boardingPass.query({ bookingId: hold.id });
  check(/^\d{4}$/.test(pass.pin), `boarding pass PIN ${pass.pin}`);
  await capture('r2-booked', { customer: `/rajaa/pass/${hold.id}`, partner: `/intercity/departure/${dep.id}`, partnerAs: 'intercity' });

  step('driver sees the rider');
  const dv = await intercity.api.routes.driver.departure.query({ departureId: dep.id });
  const b = dv.bookings.find((x) => x.bookingId === hold.id);
  check(b && b.state === 'booked', 'driver departure: the booking is on his car', { state: dv.state, cancelReason: dv.cancelReason, bookings: dv.bookings });
  const names = await intercity.api.routes.driver.riders.query({ departureId: dep.id });
  check(names.some((n) => n.bookingId === hold.id && n.firstName === 'علي'), 'driver manifest: rider first name علي', names);

  step('driver at the garage: position, selfie, PIN check-in, depart');
  const atGarage = await intercity.api.routes.driver.position.mutate({ departureId: dep.id, lat: garagePin.lat + 0.0003, lng: garagePin.lng });
  check(atGarage.driverCheckedInAt, 'garage geofence checks the driver in');
  const jpeg = jpegBytes();
  const ticket = await intercity.api.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: jpeg.length });
  await fetch(/^https?:/.test(ticket.uploadUrl) ? ticket.uploadUrl : `${BASE}${ticket.uploadUrl}`, { method: 'PUT', headers: ticket.headers, body: jpeg });
  const selfie = await intercity.api.routes.driver.selfie.mutate({ departureId: dep.id, selfieRef: ticket.uploadId });
  check(selfie.selfieAt, 'run selfie stored (uploaded photo)');
  const wrong = await intercity.api.routes.driver.checkIn.mutate({ departureId: dep.id, pin: pass.pin === '0000' ? '1111' : '0000' }).then(
    () => null,
    (e) => e,
  );
  check(wrong?.data?.code === 'pin_invalid', 'a wrong PIN is refused', wrong?.data?.code ?? wrong?.message);
  const ci = await intercity.api.routes.driver.checkIn.mutate({ departureId: dep.id, pin: pass.pin });
  check(ci.bookings.find((x) => x.bookingId === hold.id)?.state === 'checked_in', 'PIN check-in: rider on board');
  const mine = await customer.api.routes.myBookings.query();
  check(mine.find((x) => x.id === hold.id)?.state === 'checked_in', 'customer bookings: checked in', mine.find((x) => x.id === hold.id)?.state);
  await capture('r3-checked-in', { customer: `/rajaa/pass/${hold.id}`, partner: `/intercity/departure/${dep.id}`, partnerAs: 'intercity' });
  // Before the departure time a car leaves only when full: three men walk up at the garage.
  const early = await intercity.api.routes.driver.departure.query({ departureId: dep.id });
  check(early.departBlockers.some((x) => x.reason === 'too_early_not_full'), 'before its time a half-empty car may not leave (too_early_not_full)');
  for (const seatId of ['back_left', 'back_middle', 'back_right']) await intercity.api.routes.driver.markWalkUp.mutate({ departureId: dep.id, seatId, travellingAs: 'rijal' });
  const departed = await intercity.api.routes.driver.depart.mutate({ departureId: dep.id });
  check(departed.state === 'departed', 'departed', departed.state);
  const mineAfter = (await customer.api.routes.myBookings.query()).find((x) => x.id === hold.id);
  console.log(`  · customer booking after departure: ${JSON.stringify({ state: mineAfter?.state, departure: mineAfter?.departure?.state })}`);
  check(mineAfter && JSON.stringify(mineAfter).includes('departed'), 'customer booking: the car shows as departed', mineAfter?.state);
  await intercity.api.routes.driver.position.mutate({ departureId: dep.id, lat: garagePin.lat - 0.01, lng: garagePin.lng + 0.01 });
  const passAfter = await customer.api.routes.boardingPass.query({ bookingId: hold.id });
  check(passAfter.boardingOpen && passAfter.car, 'boarding pass: a car that left early is live on the rider\'s map', { boardingOpen: passAfter.boardingOpen, car: passAfter.car });
  await capture('r4-departed', { customer: `/rajaa/pass/${hold.id}`, partner: `/intercity/departure/${dep.id}`, partnerAs: 'intercity' });
}

// ───────────────────────── flow 3: tuktuk ride ─────────────────────────

async function rideFlow() {
  currentFlow = 'ride';
  const { customer, tuktuk } = people;
  const PICKUP = { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } };
  const DROPOFF = { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } };

  step('tuktuk driver: check-in, online in الهاشمي');
  check(await dailyCheckIn(tuktuk), 'daily selfie check-in passes');
  const st = await tuktuk.api.partner.goOnline.mutate({ cityId: CITY, at: { lat: 32.8975, lng: 45.0655 }, vehicleClass: 'tuktuk' });
  check(st.online && st.vehicleClass === 'tuktuk', 'online on a tuktuk');
  const cashBefore = st.cash.heldIqd;
  await capture('t0-online', { partner: '/', partnerAs: 'tuktuk' });

  step('customer asks for a tuktuk (pricing.quote → orders.place type ride)');
  const quote = await customer.api.pricing.quote.query({
    cityId: CITY,
    vertical: 'tuktuk',
    stops: [
      { zoneId: PICKUP.zoneKey, type: 'pickup', pin: PICKUP.pin },
      { zoneId: DROPOFF.zoneKey, type: 'dropoff', pin: DROPOFF.pin },
    ],
    options: { doorPickup: false, streetHandover: false },
    at: new Date(),
  });
  const ride = await customer.api.orders.place.mutate({ cityId: CITY, type: 'ride', rideVertical: 'tuktuk', fareIqd: quote.total, quoteId: quote.id, paymentMethod: 'cash', pickup: PICKUP, dropoff: DROPOFF });
  check(ride.state === 'placed' && ride.totalIqd === quote.total, `ride placed (${ride.id}), fare ${ride.totalIqd}`);
  await capture('t1-requested', { customer: `/order/${ride.id}` });

  step('the driver gets the offer');
  const offer = await until(() => tuktuk.api.partner.currentOffer.query(), { timeoutMs: 8000 });
  check(offer && offer.vertical === 'tuktuk', 'partner.currentOffer: tuktuk ride offer', offer?.vertical);
  if (!offer) return;
  check(offer.collectIqd === ride.totalIqd, `offer: collect ${offer.collectIqd} cash`, offer.collectIqd);
  await capture('t2-offer', { partner: '@current', partnerAs: 'tuktuk' });
  const resp = await tuktuk.api.dispatch.respond.mutate({ offerId: offer.offerId, accept: true });
  check(resp.outcome === 'assigned', 'accepted');
  let t = await customer.api.orders.track.query({ orderId: ride.id });
  check(t.order.state === 'matched' && t.courier?.firstName === 'عباس', 'customer: matched, driver عباس on his way', { state: t.order.state, courier: t.courier?.firstName });

  step('pickup → drop-off → complete');
  let job = await tuktuk.api.partner.activeJob.query();
  const pickup = job.stops.find((s) => s.type === 'pickup');
  const drop = job.stops.find((s) => s.type === 'dropoff');
  await tuktuk.api.trips.reportPosition.mutate({ pin: PICKUP.pin, at: new Date(), speedKmh: 0 });
  await tuktuk.api.trips.arrive.mutate({ tripId: job.tripId, stopId: pickup.stopId, pin: PICKUP.pin, occurredAt: new Date() });
  t = await customer.api.orders.track.query({ orderId: ride.id });
  check(t.trip?.state === 'arrived_pickup', 'customer: driver at the pickup', t.trip?.state);
  await capture('t3-arrived', { customer: `/order/${ride.id}`, partner: '/job', partnerAs: 'tuktuk' });
  await tuktuk.api.trips.completeStop.mutate({ tripId: job.tripId, stopId: pickup.stopId, handover: {}, occurredAt: new Date() });
  await tuktuk.api.trips.reportPosition.mutate({ pin: DROPOFF.pin, at: new Date(), speedKmh: 0 });
  await tuktuk.api.trips.arrive.mutate({ tripId: job.tripId, stopId: drop.stopId, pin: DROPOFF.pin, occurredAt: new Date() });
  job = await tuktuk.api.partner.activeJob.query();
  console.log(`  · drop-off collect ${job?.stops.find((s) => s.stopId === drop.stopId)?.collectIqd}`);
  await tuktuk.api.trips.completeStop.mutate({ tripId: job.tripId, stopId: drop.stopId, handover: { cashCollectedIqd: ride.totalIqd }, occurredAt: new Date() });
  t = await customer.api.orders.track.query({ orderId: ride.id });
  check(t.order.state === 'completed', 'customer: ride completed', t.order.state);
  const status = await until(
    async () => {
      const s = await tuktuk.api.partner.status.query();
      return s.cash.heldIqd > cashBefore ? s : null;
    },
    { timeoutMs: 5000 },
  );
  check(status, `partner: cash held rises after the ride (${cashBefore} → ${status?.cash.heldIqd})`);
  await capture('t4-completed', { customer: `/order/${ride.id}`, partner: '/', partnerAs: 'tuktuk' });

  step('customer rates the driver');
  const rated = await customer.api.orders.rate.mutate({ orderId: ride.id, delivery: 5 });
  check(rated.rating?.delivery === 5, 'orders.rate stored on the ride', rated.rating);
  await tuktuk.api.partner.goOffline.mutate({});
}

// ───────────────────────── run ─────────────────────────

try {
  for (const [name, fn] of [
    ['food', foodFlow],
    ['rajaa', rajaaFlow],
    ['ride', rideFlow],
  ]) {
    if (!FLOWS.has(name)) continue;
    try {
      await fn();
    } catch (err) {
      failures += 1;
      console.error(`\n[${currentFlow}] crashed:`, err?.stack ?? err);
      results.push({ flow: currentFlow, ok: false, what: `crash: ${err?.message ?? err}` });
    }
  }
} catch (err) {
  failures += 1;
  console.error(`\n[${currentFlow}] crashed:`, err?.stack ?? err);
  results.push({ flow: currentFlow, ok: false, what: `crash: ${err?.message ?? err}` });
} finally {
  for (const x of taps) x.close();
  if (shots) await shots.close();
}

console.log('\nSummary');
for (const flow of [...new Set(results.map((r) => r.flow))]) {
  const rs = results.filter((r) => r.flow === flow);
  console.log(`  ${flow}: ${rs.filter((r) => r.ok).length}/${rs.length} checks passed`);
}
if (process.env.KEEP) console.log(`KEEP=1: API stays up at ${BASE}/trpc (pid ${process.pid})`);
else {
  await app.close();
  process.exit(failures ? 1 : 0);
}
