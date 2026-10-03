// Three-app end-to-end walk on ONE in-memory API (the built apps/api/dist, no Postgres/Redis).
//
//   pnpm turbo run build --filter='./packages/*' && pnpm --filter @driver/api build
//   node scripts/e2e/three-apps.mjs                      # all flows, API assertions only
//   FLOWS=food,rajaa,ride node scripts/e2e/three-apps.mjs
//   KEEP=1 node scripts/e2e/three-apps.mjs               # keep the API up on :3340 afterwards
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

const { createTRPCClient, httpBatchLink } = await fromApp('@trpc/client');
const contracts = await fromApp('@driver/contracts');
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
  return { personId, phone, tokens: out.tokens, api };
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

  step('customer places a cash order for two people (orders.place)');
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
  check(order.totalIqd === cheap.priceIqd + second.priceIqd + fees.deliveryFeeIqd + fees.serviceFeeIqd, 'server total = items + quoted fees');

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
  await capture('1-placed', { customer: `/order/${orderId}`, merchant: '/', partner: '/' });

  step('kitchen accepts with 15 min prep (orders.merchant.accept)');
  const accepted = await staff.api.orders.merchant.accept.mutate({ orderId, prepMinutes: 15 });
  check(accepted.state === 'merchant_accepted', 'order accepted', accepted.state);
  c = await cardOf(orderId);
  check(c?.column === 'preparing', 'merchant board: moved to "preparing"', c?.column);
  t = await track(orderId);
  check(['merchant_accepted', 'preparing'].includes(t.order.state) && t.promisedAt, 'customer tracking: accepted with a promised time', { state: t.order.state, promisedAt: t.promisedAt });
  check(c?.card.courier?.state === 'searching' || c?.card.courier?.state === 'none', 'merchant board: courier "searching"', c?.card.courier);
  const early = await courier.api.partner.currentOffer.query();
  console.log(`  · offer right after accept: ${early ? 'yes' : 'no (scheduled for ready − ETA − 2 min)'}`);
  await capture('2-accepted', { customer: `/order/${orderId}`, merchant: '/', partner: '/' });

  step('kitchen marks ready early → courier offer goes out now');
  const ready = await staff.api.orders.merchant.ready.mutate({ orderId });
  check(ready.state === 'ready', 'order ready', ready.state);
  c = await cardOf(orderId);
  check(c?.column === 'ready', 'merchant board: moved to "ready"', c?.column);
  const offer = await until(() => courier.api.partner.currentOffer.query(), { timeoutMs: 8000 });
  check(offer, 'partner.currentOffer: the courier gets the offer');
  if (!offer) return;
  check(offer.vertical === 'food' && offer.pickup.label === khalid.seed.nameAr, `offer: food pickup at ${offer.pickup.label}`);
  check(offer.collectIqd === order.totalIqd, 'offer: cash to collect = order total', offer.collectIqd);
  check(offer.pay.totalIqd > 0, `offer: named pay ${offer.pay.components?.map((p) => `${p.key}=${p.amountIqd}`).join(', ')}`);
  await capture('3-offer', { customer: `/order/${orderId}`, merchant: '/', partner: '/offer' });

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

// ───────────────────────── run ─────────────────────────

try {
  if (FLOWS.has('food')) await foodFlow();
} catch (err) {
  failures += 1;
  console.error(`\n[${currentFlow}] crashed:`, err?.stack ?? err);
  results.push({ flow: currentFlow, ok: false, what: `crash: ${err?.message ?? err}` });
} finally {
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
