// Demo API for the Console's launch-week control room (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — `pnpm --filter @driver/api build` first) fully in memory: no Postgres/Redis, dev
// OTPs readable through identity.devLastOtp.
//
//   PORT=3395 node apps/console/scripts/demo-api.mjs
//
// Seeds a launch evening in Aziziyah: the live simulator (couriers, orders, deliveries, cash) for the
// metrics wall and the cash desk; zone caps (one zone full, one busy); a zone switched off with
// "hold dispatch"; a status banner; documents, a deal, landmark photos, an onboarding draft and a
// fleet vehicle waiting in the approvals queue (photos rendered with Playwright when
// PLAYWRIGHT_MODULE / CHROMIUM_PATH are set, plain JPEG bytes otherwise); support tickets (two
// disputes, a WhatsApp complaint, one open for 26 hours).
//
// مطعم خالد has a pickup spot set by its owner (Console › المطاعم, /stores/<id>; GET /demo/seed gives the link).
//
// People (log in at /login with the phone; the dev OTP fills itself):
//   0770 000 0001  علي     admin + dispatcher + support + finance (sees and changes everything)
//   0770 000 0002  حيدر    field ops (took the photos, drafted the merchant: those are his own items)
//   0770 000 0003  زينب    support agent (10,000 a day refund limit)
// GET /demo/seed lists them. POST /demo/cash-change → the latest order where the courier had no change
// and the rest went to the customer's wallet ("الخردة علينا"), with its courier (order page, his ledger).
// GET /demo/handover-code?driverId=… is the code a courier's app shows today (to tick him off on the
// 23:00 round, S-K5). POST /demo/khat-sweep[?late=1] → a خطوط run that ended without the empty-car
// check (the red row under the SOS banner; `late=1`: confirmed late). POST /demo/pin-alert[?kind=wrong]
// → a الرجعة driver types one rider's seat PIN on another rider's seat (the cross-use row on the same
// strip, with the car's PIN history); `kind=wrong`: three wrong PINs on one seat.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { avatarPng } from '../../../scripts/dev/demo-avatar.mjs';
import { pickupWindowPng } from '../../partner/scripts/door-photo.mjs';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);
const PORT = Number(process.env.PORT ?? 3395);
const SIM_SECONDS = Number(process.env.DEMO_SIM_SECONDS ?? 45);

// The 23:00 round counts receipts from 18:00 Baghdad; the demo counts them from midnight so «استلمت»
// moves "جمعنا … من …" at any hour of the day (CASH_ROUND_FROM_HOUR=18 for the real window).
process.env.CASH_ROUND_FROM_HOUR ??= '0';
// Outlines drawn in the demo Console (Zones page) are written here so they survive restarts.
process.env.ZONES_STORE_FILE ??= fileURLToPath(new URL('../../../.studio/zones-placements.json', import.meta.url));
const { createApp } = await load('bootstrap.js');
const { IdentityService } = await load('modules/identity/index.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService, seedStorefronts } = await load('modules/catalog/index.js');
const { OrdersService } = await load('modules/orders/index.js');
const { DispatchService } = await load('modules/dispatch/index.js');
const { LedgerService, LedgerFacade } = await load('modules/ledger/index.js');
const { DriverAccountService } = await load('modules/driver-account/index.js');
const { OpsService } = await load('modules/ops/index.js');
const { FleetService, FLEET_REPOSITORY } = await load('modules/fleet/index.js');
const { MerchantAdminService } = await load('modules/merchant-admin/index.js');
const { MerchantService } = await load('modules/merchant/index.js');
const { ControlsService } = await load('modules/controls/index.js');
const { SupportService, SUPPORT_REPOSITORY } = await load('modules/support/index.js');
const { EventsService } = await load('modules/events/index.js');
const { BLOB_STORE } = await load('modules/places/index.js');
const { SimulatorService } = await load('modules/simulator/index.js');
const { AZIZIYAH_RESTAURANTS } = await import(pathToFileURL(requireFromApi.resolve('@driver/contracts/seeds')).href);

const app = await createApp();
const people = {};
app.use('/demo/seed', (_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ people }));
});
// POST /demo/sos (registered before listen; the seeding below fills in `raiseDemoSos`).
let raiseDemoSos = null;
app.use('/demo/sos', async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (!raiseDemoSos) throw new Error('still seeding');
    const who = new URL(req.originalUrl ?? req.url ?? '/', 'http://x').searchParams.get('who') ?? 'driver';
    res.end(JSON.stringify(await raiseDemoSos(who)));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
// POST /demo/khat-sweep[?late=1] (registered before listen; filled in below by `raiseDemoSweep`).
let raiseDemoSweep = null;
app.use('/demo/khat-sweep', async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (!raiseDemoSweep) throw new Error('still seeding');
    const late = new URL(req.originalUrl ?? req.url ?? '/', 'http://x').searchParams.get('late') === '1';
    res.end(JSON.stringify(await raiseDemoSweep(late)));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
// POST /demo/pin-alert[?kind=wrong] (registered before listen; filled in below by `raiseDemoPinAlert`).
let raiseDemoPinAlert = null;
app.use('/demo/pin-alert', async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (!raiseDemoPinAlert) throw new Error('still seeding');
    const kind = new URL(req.originalUrl ?? req.url ?? '/', 'http://x').searchParams.get('kind') === 'wrong' ? 'wrong' : 'cross';
    res.end(JSON.stringify(await raiseDemoPinAlert(kind)));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
// POST /demo/cash-change → {orderId, courierId}: the latest order where the courier had no change and
// the rest of the customer's note went to his wallet ("الخردة علينا"; the simulator does it on about one
// cash drop-off in eight), for the order detail and the courier's ledger.
app.use('/demo/cash-change', async (_req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    const ledger = app.get(LedgerService);
    let found = null;
    for (const account of await ledger.accounts()) {
      if (!account.startsWith('cash:')) continue;
      for (const e of await ledger.eventsFor(account)) {
        if (e.type === 'cash_change_to_wallet' && e.orderId && (!found || e.occurredAt > found.occurredAt)) found = e;
      }
    }
    if (!found) throw new Error('no change-to-wallet hand-over yet (the simulator is still warming up)');
    res.end(JSON.stringify({ orderId: found.orderId, courierId: found.fromAccount.slice('cash:'.length), amountIqd: found.amount }));
  } catch (err) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
// GET /demo/handover-code?driverId=… — the 4-digit code that courier's app shows today (S-K5: tick a
// courier off on the 23:00 round with "استلمت" as field ops would, by reading it from his phone).
let handoverCodeOf = null;
app.use('/demo/handover-code', async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (!handoverCodeOf) throw new Error('still seeding');
    const driverId = new URL(req.originalUrl ?? req.url ?? '/', 'http://x').searchParams.get('driverId') ?? '';
    res.end(JSON.stringify(await handoverCodeOf(driverId)));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
await app.listen(PORT);
const origin = `http://127.0.0.1:${PORT}`;
const get = (cls) => app.get(cls);
const identity = get(IdentityService);
const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };
const actor = (personId) => ({ personId, sessionId: 'demo' });

async function person(phone, name, roles = []) {
  const id = await identity.ensurePersonByPhone(phone, 'system:demo', 'demo');
  if (name) await identity.updateProfile(actor(id), { name });
  for (const r of roles) await identity.grantRole(SYSTEM, typeof r === 'string' ? { personId: id, kind: r } : { personId: id, ...r });
  return id;
}

// ───────────────────────── photos ─────────────────────────

/** A demo image as JPEG bytes: an HTML card rendered by Chromium when available, else a 1-pixel JPEG. */
let browser = null;
if (process.env.PLAYWRIGHT_MODULE) {
  try {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  } catch (err) {
    console.warn('demo photos: no browser, plain bytes', String(err).slice(0, 120));
  }
}
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
async function render(html, w = 640, h = 420) {
  if (!browser) return TINY_JPEG;
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html dir="rtl"><body style="margin:0;font-family:'IBM Plex Sans Arabic','Noto Sans Arabic',sans-serif">${html}</body></html>`);
  const buf = await page.screenshot({ type: 'jpeg', quality: 82 });
  await page.close();
  return buf;
}
const idCard = (title, name, color, extra = '') => `
  <div style="width:640px;height:420px;background:linear-gradient(135deg,${color},#f4efe6);display:flex;align-items:center;justify-content:center">
    <div style="width:560px;height:340px;border-radius:22px;background:#fffdf8;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:26px;box-sizing:border-box;position:relative">
      <div style="font-size:15px;color:#7a6b58">جمهورية العراق · عيّنة للعرض</div>
      <div style="font-size:30px;font-weight:700;margin-top:6px;color:#2a2219">${title}</div>
      <div style="display:flex;gap:22px;margin-top:22px">
        <div style="width:130px;height:160px;border-radius:12px;background:linear-gradient(180deg,#c9b8a2,#9c8467);display:flex;align-items:flex-end;justify-content:center"><div style="width:84px;height:84px;border-radius:50%;background:#e8dccb;margin-bottom:24px"></div></div>
        <div style="font-size:20px;line-height:1.9;color:#2a2219">
          <div>الاسم: <b>${name}</b></div><div>الرقم: <span dir="ltr">0000 0000 00</span></div>${extra}
        </div>
      </div>
      <div style="position:absolute;left:26px;bottom:22px;font-size:13px;color:#b04b2f;border:2px solid #b04b2f;border-radius:8px;padding:2px 10px;transform:rotate(-8deg)">DEMO</div>
    </div>
  </div>`;
const scene = (title, sub, a, b) => `
  <div style="width:640px;height:420px;background:linear-gradient(180deg,${a} 0%,${b} 70%,#3b3328 100%);position:relative;overflow:hidden">
    <div style="position:absolute;bottom:0;left:0;right:0;height:150px;background:linear-gradient(180deg,#6d5c48,#3e3427)"></div>
    <div style="position:absolute;bottom:120px;right:80px;width:180px;height:190px;background:#e9dcc6;border-radius:8px 8px 0 0"></div>
    <div style="position:absolute;bottom:310px;right:140px;width:60px;height:60px;border-radius:50% 50% 0 0;background:#3f8f7a"></div>
    <div style="position:absolute;bottom:120px;left:70px;width:26px;height:250px;background:#e9dcc6"></div>
    <div style="position:absolute;top:22px;right:24px;color:#fff;font-size:30px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,.5)">${title}</div>
    <div style="position:absolute;top:66px;right:24px;color:#fff;font-size:18px;text-shadow:0 2px 8px rgba(0,0,0,.5)">${sub}</div>
  </div>`;
const menu = (name, items) => `
  <div style="width:640px;height:420px;background:#f6efe3;padding:24px;box-sizing:border-box">
    <div style="font-size:30px;font-weight:700;color:#7a2f1d;border-bottom:3px solid #7a2f1d;padding-bottom:8px">${name}</div>
    ${items.map(([n, p]) => `<div style="display:flex;justify-content:space-between;font-size:22px;margin-top:14px;color:#2a2219"><span>${n}</span><span dir="ltr">${p}</span></div>`).join('')}
  </div>`;

const blobs = get(BLOB_STORE);
async function upload(ownerId, bytes, contentType = 'image/jpeg') {
  const ticket = await blobs.createUpload({ ownerId, contentType, sizeBytes: bytes.length });
  const res = await fetch(new URL(ticket.uploadUrl, origin), { method: 'PUT', headers: ticket.headers, body: bytes });
  if (res.status !== 200) throw new Error(`upload ${res.status}`);
  return ticket.uploadId;
}

// ───────────────────────── staff ─────────────────────────

const ali = await person('07700000001', 'علي', ['admin', 'dispatcher', 'support', 'finance']);
const haider = await person('07700000002', 'حيدر', ['field_ops']);
const zainab = await person('07700000003', 'زينب', ['support']);
Object.assign(people, { ali: { phone: '07700000001', id: ali }, haider: { phone: '07700000002', id: haider }, zainab: { phone: '07700000003', id: zainab } });

// ───────────────────────── the live evening (simulator) ─────────────────────────

// The warm-up runs the evening at 60×, so its finished orders happened seconds apart. Afterwards
// their history is stretched back to real minutes ("انطلب 10:08 م · وصل 10:52 م" on /orders/[id]):
// each finished order's own times, its event log, its trips' logs and its ledger lines move to
// `now − (now − t) × 60`. Only finished orders move (nothing live depends on their clocks); the
// app keeps the wall clock, so dispatch timers stay honest. DEMO_HISTORY=0 skips the stretch.
const SIM_SPEED = 60;
const t0 = Date.now();
const sim = get(SimulatorService);
await sim.start({ cityId: 'aziziyah', drivers: 24, ordersPerHour: 70, seed: 7, speed: SIM_SPEED });
console.log(`simulator running ${SIM_SECONDS}s…`);
await new Promise((r) => setTimeout(r, SIM_SECONDS * 1000));
if (process.env.DEMO_HISTORY !== '0') {
  const { ORDERS_REPOSITORY } = await load('modules/orders/index.js');
  const ordersRepo = get(ORDERS_REPOSITORY);
  const events = get(EventsService);
  const ledgerSvc = get(LedgerService);
  const now = Date.now();
  const at = (v) => (v instanceof Date && v.getTime() >= t0 && v.getTime() <= now ? new Date(now - (now - v.getTime()) * SIM_SPEED) : v);
  // Stored rows may be frozen: each moved row is a stretched copy, swapped into its repository's
  // arrays and maps in place of the original.
  const copy = (rec) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, at(v)]));
  const frozenCopy = (rec) => (Object.isFrozen(rec) ? Object.freeze(copy(rec)) : copy(rec));
  const swapIn = (repo, swaps) => {
    if (!repo || swaps.size === 0) return;
    const fix = (list) => {
      for (let i = 0; i < list.length; i += 1) if (swaps.has(list[i])) list[i] = swaps.get(list[i]);
    };
    for (const key of Object.getOwnPropertyNames(repo)) {
      const v = repo[key];
      if (Array.isArray(v)) fix(v);
      else if (v instanceof Map) for (const [k, x] of v) Array.isArray(x) ? fix(x) : swaps.has(x) && v.set(k, swaps.get(x));
    }
  };
  const FINISHED = new Set(['delivered', 'completed', 'closed', 'customer_cancelled', 'merchant_rejected', 'platform_cancelled', 'failed', 'refunded']);
  const eventSwaps = new Map();
  const ledgerSwaps = new Map();
  const orderSwaps = new Map();
  let moved = 0;
  for (const o of [...(ordersRepo.orders?.values?.() ?? [])]) {
    if (!FINISHED.has(o.state)) continue;
    const moved_ = copy(o);
    // The kitchen's promise was set in wall minutes after the acceptance: it moves with it.
    if (o.promisedReadyAt && o.acceptedAt && moved_.acceptedAt) moved_.promisedReadyAt = new Date(moved_.acceptedAt.getTime() + (o.promisedReadyAt.getTime() - o.acceptedAt.getTime()));
    orderSwaps.set(o, Object.isFrozen(o) ? Object.freeze(moved_) : moved_);
    moved += 1;
    const trips = new Set();
    for (const e of await events.forOrder(o.id)) {
      if (!eventSwaps.has(e)) eventSwaps.set(e, frozenCopy(e));
      if (e.tripId) trips.add(e.tripId);
    }
    for (const tripId of trips) for (const e of await events.forTrip(tripId)) if (!eventSwaps.has(e)) eventSwaps.set(e, frozenCopy(e));
    for (const l of await ledgerSvc.eventsForOrder(o.id)) if (!ledgerSwaps.has(l)) ledgerSwaps.set(l, frozenCopy(l));
  }
  swapIn(ordersRepo, orderSwaps);
  swapIn(events.repo, eventSwaps);
  swapIn(ledgerSvc.repo, ledgerSwaps);
  console.log(`stretched ${moved} finished orders back to real minutes`);
}
// DEMO_LIVE_SPEED=1 carries on the same evening in real time (orders arrive about one a minute and
// read like real minutes on /orders); the default keeps the 60× traffic that makes the map glide.
// DEMO_LIVE=0 stops the simulator here instead.
if (process.env.DEMO_LIVE === '0') await sim.stop();
else if (process.env.DEMO_LIVE_SPEED && sim.live) sim.live.speed = Number(process.env.DEMO_LIVE_SPEED);

// ───────────────────────── yesterday (the wall's «أمس بهالوقت») ─────────────────────────
// The launch wall compares each tile with the same clock time yesterday (S-K6). The demo starts
// today, so it writes a yesterday as the evening goes: four in five delivered orders again 24 hours
// earlier (a little slower: +3 minutes to the door), the dispatch offers too (one in four accepted
// ones declined), every 30 s so yesterday keeps pace with the live traffic; and الرجعة seats booked
// yesterday further down. Copies only, with their own ids; DEMO_YESTERDAY=0 skips it.
const DAY_MS = 86_400_000;
const seedYesterday = process.env.DEMO_YESTERDAY !== '0';
if (seedYesterday) {
  const { ORDERS_REPOSITORY } = await load('modules/orders/index.js');
  const { DISPATCH_REPOSITORY } = await load('modules/dispatch/dispatch.repository.js');
  const ordersRepo = get(ORDERS_REPOSITORY);
  const offersRepo = app.get(DISPATCH_REPOSITORY, { strict: false });
  const back = (v) => (v instanceof Date ? new Date(v.getTime() - DAY_MS) : v);
  const shift = (rec) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, back(v)]));
  const seen = new Set();
  let n = 0;
  let accepted = 0;
  const copyToYesterday = () => {
    for (const o of [...(ordersRepo.orders?.values?.() ?? [])]) {
      if (!o.deliveredAt || o.id.endsWith('_y') || seen.has(o.id)) continue;
      seen.add(o.id);
      n += 1;
      if (n % 5 === 0) continue;
      const y = { ...shift(o), id: `${o.id}_y` };
      y.deliveredAt = new Date(y.deliveredAt.getTime() + 3 * 60_000);
      ordersRepo.orders.set(y.id, y);
      const lines = (ordersRepo.linesByOrder?.get(o.id) ?? []).map((l) => ({ ...l, id: `${l.id}_y`, orderId: y.id }));
      const parts = (ordersRepo.participantsByOrder?.get(o.id) ?? []).map((p) => ({ ...p, id: `${p.id}_y`, orderId: y.id }));
      ordersRepo.lines?.push(...lines);
      ordersRepo.participants?.push(...parts);
      ordersRepo.linesByOrder?.set(y.id, lines);
      ordersRepo.participantsByOrder?.set(y.id, parts);
    }
    for (const row of [...(offersRepo?.rows?.values?.() ?? [])]) {
      if (row.state === 'sent' || row.state === 'seen' || row.id.endsWith('_y') || seen.has(row.id)) continue;
      seen.add(row.id);
      const y = { ...shift(row), id: `${row.id}_y`, tripId: `${row.tripId}_y` };
      if (y.state === 'accepted' && accepted++ % 4 === 3) y.state = 'declined';
      offersRepo.rows.set(y.id, y);
    }
  };
  copyToYesterday();
  setInterval(copyToYesterday, 30_000).unref?.();
  console.log(`yesterday: ${n} delivered orders so far, copied 24 h back (and every 30 s)`);
}

// ───────────────────────── restaurants, orders and zone caps ─────────────────────────

const orgs = get(OrgsService);
const stores = await seedStorefronts(orgs, get(CatalogService), AZIZIYAH_RESTAURANTS.map((r) => ({ ...r, hours: [] })), 'demo-owner');
await orgs.settled?.();
const khalid = stores.find((s) => s.seed.key === 'khalid');
const orders = get(OrdersService);
const ZONE_PINS = { zakur: { lat: 32.887, lng: 45.0765 }, centre: { lat: 32.905, lng: 45.06 }, hashimi: { lat: 32.896, lng: 45.0675 }, shukri: { lat: 32.8945, lng: 45.0545 } };
const customers = [];
for (let i = 0; i < 16; i += 1) customers.push(await person(`0771${String(5000000 + i).padStart(7, '0')}`, ['زينب', 'مصطفى', 'نور', 'حسين', 'رقية', 'سجاد', 'فاطمة', 'كرار'][i % 8]));
const placed = [];
async function place(customerId, zoneKey, key = 'liver_plate') {
  const o = await orders.place(customerId, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, lines: [{ catalogItemId: khalid.itemIds.get(key), qty: 1 }], paymentMethod: 'cash', dropoff: { zoneKey, pin: ZONE_PINS[zoneKey] } });
  await orders.merchantAccept('demo-staff', { orderId: o.id, prepMinutes: 45 });
  placed.push(o);
  return o;
}
for (let i = 0; i < 6; i += 1) await place(customers[i], 'zakur');
for (let i = 6; i < 14; i += 1) await place(customers[i], 'centre');
for (let i = 14; i < 16; i += 1) await place(customers[i], 'hashimi');

const controls = get(ControlsService);
const counts = await orders.activeByZone('aziziyah');
await controls.setCapacity(actor(ali), { cityId: 'aziziyah', zoneKey: 'zakur', maxActive: counts.get('zakur') ?? 6, mode: 'refuse', etaMin: 15 });
await controls.setCapacity(actor(ali), { cityId: 'aziziyah', zoneKey: 'centre', maxActive: Math.ceil(((counts.get('centre') ?? 8) / 0.85)), mode: 'queue', etaMin: 30 });
await controls.setCapacity(actor(ali), { cityId: 'aziziyah', zoneKey: 'hashimi', maxActive: 8, mode: 'refuse', etaMin: 15 });
await controls.setCapacity(actor(ali), { cityId: 'aziziyah', zoneKey: 'street_30', maxActive: 12, mode: 'refuse', etaMin: 20 });
const midnight = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000);
await controls.setSwitch(actor(ali), { cityId: 'aziziyah', scope: 'zone', key: 'khamas', active: true, holdDispatch: true, reason: 'مطر قوي والطريق طين', message_ar: 'الطريق للخماس مسدود بسبب المطر، نرجع نوصل باچر الصبح', expiresAt: midnight });
await controls.setSwitch(actor(ali), { cityId: 'aziziyah', scope: 'vertical', key: 'parcel', active: true, holdDispatch: false, reason: 'تجربة المفتاح قبل الافتتاح' });
await controls.setSwitch(actor(ali), { cityId: 'aziziyah', scope: 'vertical', key: 'parcel', active: false, holdDispatch: false, reason: 'المفتاح يشتغل، رجعت' });
await controls.setBanner(actor(ali), { severity: 'warning', audiences: ['customer', 'partner'], message_ar: 'المطر قوي الليلة، التوصيل يتأخر شوية. شكراً لصبركم', expiresAt: new Date(Date.now() + 4 * 3_600_000) });
// Seasons (J6): the next mourning day, Ramadan 1448 over both start days with one day fixed to the
// local mosque's Shia time, and Eid al-Fitr. Skipped once those dates have passed.
const demoToday = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
if (demoToday <= '2026-11-13') await controls.setQuietDays(actor(ali), { cityId: null, startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء (3 جمادى الآخرة)' });
if (demoToday <= '2027-02-07') {
  const ramadan = await controls.setSeason(actor(ali), { cityId: null, kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09', label_ar: 'رمضان 1448' });
  await controls.setIftarTime(actor(ali), { seasonId: ramadan.id, day: '2027-02-08', timetable: 'shia', time: '17:57' });
  await controls.setSeason(actor(ali), { cityId: null, kind: 'eid', startsOn: '2027-03-09', endsOn: '2027-03-12', label_ar: 'عيد الفطر' });
}

// ───────────────────────── approvals queue ─────────────────────────

const accounts = get(DriverAccountService);
handoverCodeOf = (driverId) => accounts.handoverCode({ personId: driverId, sessionId: 'demo' });
const ops = get(OpsService);
const couriers = [
  { phone: '07720000001', name: 'مرتضى' },
  { phone: '07720000002', name: 'عباس' },
];
for (const c of couriers) {
  c.id = await person(c.phone, c.name, ['courier']);
  await accounts.uploadDocument(actor(c.id), { kind: 'national_id_front', uploadId: await upload(c.id, await render(idCard('البطاقة الوطنية الموحدة', c.name, '#5b8fb9'))) });
}
// Murtadha's ID was approved yesterday: his new licence compares against it.
const idDoc = (await accounts.documentsFor(couriers[0].id)).documents.find((d) => d.kind === 'national_id_front');
await accounts.reviewDocument(actor(haider), { documentId: idDoc.id, decision: 'approve' });
await accounts.uploadDocument(actor(couriers[0].id), {
  kind: 'licence',
  uploadId: await upload(couriers[0].id, await render(idCard('إجازة السياقة', couriers[0].name, '#7a9a5b', '<div>الصنف: دراجة نارية</div>'))),
  expiresAt: new Date(Date.now() + 2 * 365 * 86_400_000),
});
// Main photos (Ali, 2026-10-06): Murtadha's was approved (customers see it); he sent a new one that
// waits in the queue as «الصورة الرئيسية» next to the approved one; Abbas's first photo waits too.
{
  const sent = await accounts.setMainPhoto(actor(couriers[0].id), { uploadId: await upload(couriers[0].id, avatarPng('مرتضى'), 'image/png') });
  await accounts.reviewDocument(actor(haider), { documentId: sent.latest.documentId, decision: 'approve' });
  await accounts.setMainPhoto(actor(couriers[0].id), { uploadId: await upload(couriers[0].id, avatarPng('مرتضى · جديدة'), 'image/png') });
  await accounts.setMainPhoto(actor(couriers[1].id), { uploadId: await upload(couriers[1].id, avatarPng('عباس'), 'image/png') });
}
// Haider drives too: his own licence waits for someone else.
await identity.grantRole(SYSTEM, { personId: haider, kind: 'courier' });
await accounts.uploadDocument(actor(haider), { kind: 'licence', uploadId: await upload(haider, await render(idCard('إجازة السياقة', 'حيدر', '#7a9a5b'))) });

await ops.addLandmarkPhoto(actor(haider), { target: { kind: 'landmark', id: 'new:zakur' }, uploadId: await upload(haider, await render(scene('جامع زاكور الكبير', 'المدخل الرئيسي · يم السوك', '#8fb3d9', '#d9c7a8'))), caption: 'المدخل الرئيسي', localNames: ['جامع زاكور', 'يم الجامع الكبير'] });
await ops.addLandmarkPhoto(actor(zainab), { target: { kind: 'landmark', id: 'new:centre' }, uploadId: await upload(zainab, await render(scene('دوّار الساعة', 'وسط العزيزية', '#f0b37e', '#d9c7a8'))), localNames: ['دوّار الساعة'] });
await ops.merchantOnboarding(actor(haider), {
  cityId: 'aziziyah',
  name: 'فلافل أبو علي',
  type: 'restaurant',
  contact: { name: 'أبو علي', phone: '07730000001' },
  location: { zoneKey: 'hashimi' },
  menuPhotoUploadIds: [await upload(haider, await render(menu('فلافل أبو علي', [['لفة فلافل', '1,000'], ['صمونة فلافل', '750'], ['صحن فلافل', '3,000'], ['عمبة إضافية', '250']])))],
  shopPhotoUploadId: await upload(haider, await render(scene('فلافل أبو علي', 'شارع المحدود · الهاشمي', '#e9a65b', '#d9c7a8'))),
  notes: 'يفتح من 4 العصر لحد 12 بالليل',
});
const khalidOwner = await person('07740000001', 'خالد', [{ kind: 'merchant_owner', orgId: khalid.orgId }]);
await get(MerchantAdminService).dealsPropose(actor(khalidOwner), {
  merchantOrgId: khalid.orgId,
  type: 'percent',
  value: 15,
  nameAr: 'خصم الافتتاح على المشويات',
  itemIds: [],
  schedule: { startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000), days: [] },
  budgetCapIqd: 150_000,
  minOrderIqd: 10_000,
});
// Pickup spot (Console › المطاعم, Ali 2026-10-07): Khalid set his takeaway window and a note from the
// Merchant app, so /stores/<khalid> opens on the owner's spot; علي (0770 000 0001) and حيدر (…0002)
// can change it there, زينب (support) can't see the page. The photo is the owner's own upload.
await get(MerchantService).setPickupSpot(actor(khalidOwner), {
  merchantOrgId: khalid.orgId,
  note: 'الاستلام من الشباك اليسار، جنب باب المطبخ',
  photoIds: [await upload(khalidOwner, pickupWindowPng(), 'image/png')],
});
people.khalid = { phone: '07740000001', id: khalidOwner, storeId: khalid.orgId, stores: `/stores/${khalid.orgId}` };
// A chat on the order behind the WhatsApp ticket, read-only on /orders/[id] and the desk.
try {
  const { ChatService } = await load('modules/chat/index.js');
  const chat = get(ChatService);
  const say = (who, text, i) => chat.send(actor(who), { orderId: placed[9].id, kind: 'customer_merchant', clientId: `demo-chat-${i}`, text });
  await say(customers[9], 'شكد يتأخر الطلب؟ صارلي ساعة أنتظر', 1);
  await say(khalidOwner, 'هلا بيك، هسة يطلع من المطبخ والدليفري جاي ياخذه', 2);
  await say(customers[9], 'زين، بس المرة اللي فاتت ما رجّعولي الباقي', 3);
} catch (err) {
  console.warn('demo chat skipped:', err?.message ?? err);
}
const fleetOwner = await person('07750000001', 'أبو حسنين');
const fleetOrg = await orgs.create({ type: 'fleet', name: 'تكاتك الربيعي', cityId: 'aziziyah', ownerId: fleetOwner });
await identity.grantRole(SYSTEM, { personId: fleetOwner, kind: 'fleet_owner', orgId: fleetOrg.id });
await get(FleetService).addVehicle(actor(fleetOwner), { fleetOrgId: fleetOrg.id, plate: 'واسط 48213', vehicleClass: 'tuktuk' });

// ───────────────────────── support desk ─────────────────────────

const events = get(EventsService);
const support = get(SupportService);
await events.emit(undefined, { type: 'order.disputed', actorId: customers[0], occurredAt: new Date(), orderId: placed[0].id, payload: { kind: 'cold_or_late', note: 'الطلب وصل بعد ساعة وبارد، هذا غش', openedBy: 'customer' } }, { name: 'order', id: placed[0].id });
await events.emit(undefined, { type: 'order.disputed', actorId: customers[7], occurredAt: new Date(), orderId: placed[7].id, payload: { kind: 'missing_item', note: 'ناقص الصمون والطرشي', openedBy: 'customer' } }, { name: 'order', id: placed[7].id });
const wa = await support.open(actor(zainab), { cityId: 'aziziyah', kind: 'complaint', channel: 'whatsapp', subject: 'المندوب ما رجّع الباقي (2,000)', note: 'دفعت 10 آلاف والطلب 8,000، گال ما عندي فكة', customerId: customers[9], orderId: placed[9].id });
await support.reply(actor(zainab), { ticketId: wa.id, text: 'حقّك علينا، دا نتابع ويا المندوب ونرجعلك خلال ربع ساعة', internal: false });
// One left overnight: opened 26 hours ago, never answered (the wall counts it).
const repo = get(SUPPORT_REPOSITORY);
const old = new Date(Date.now() - 26 * 3_600_000);
const stale = await repo.create({ cityId: 'aziziyah', kind: 'question', status: 'open', channel: 'phone', subject: 'متى يوصل التوصيل لمشروع عويد؟', orderId: null, tripId: null, customerId: customers[12], openedById: zainab, openedAt: old, firstResponseAt: null, resolvedAt: null, slaDueAt: new Date(old.getTime() + 6 * 3_600_000), assigneeId: null, faultParty: 'none', refundedIqd: 0, escalatedTo: null, escalatedAt: null, resolution: null, sourceKey: null, reopenCount: 0, lastActivityAt: old });
await repo.addEntry({ ticketId: stale.id, actorId: customers[12], kind: 'opened', text: 'سألت أكثر من مرة وما أحد جاوب', amountIqd: null, meta: {}, idempotencyKey: null, at: old });
// A desk with some history: an internal note on the late-food dispute, علي answering the missing-item
// one (so it's "his"), and a safety incident called in by phone.
const queue = (await support.list(actor(ali), { cityId: 'aziziyah', status: 'active', limit: 100 })).rows;
const late = queue.find((r) => r.orderId === placed[0].id);
if (late) await support.reply(actor(zainab), { ticketId: late.id, text: 'اتصلت بالمطعم: الطلب طلع بوقته، التأخير من الدليفري بالطريق. نعوّضه رصيد ونحسبها على الدليفري.', internal: true });
const missing = queue.find((r) => r.orderId === placed[7].id);
if (missing) await support.reply(actor(ali), { ticketId: missing.id, text: 'هلا بيك، شفنا طلبك. الصمون والطرشي ناقصين من المطعم، دا نرجعلك سعرهم هسة.', internal: false });
await support.open(actor(ali), { cityId: 'aziziyah', kind: 'incident', channel: 'phone', subject: 'الدليفري سايق بسرعة بالدربونة', note: 'جارهم اتصل: دراجة الطلب كادت تدعم طفل يم المدرسة', customerId: customers[5], orderId: placed[5].id });
const solved = await support.open(actor(zainab), { cityId: 'aziziyah', kind: 'question', channel: 'in_app', subject: 'شلون أشحن المحفظة كاش؟', customerId: customers[3] });
await support.resolve(actor(zainab), { ticketId: solved.id, resolution: 'شرحناله الشحن عن طريق المندوب أو وكيل' });

// ───────────────────────── cash desk ─────────────────────────

const ledger = get(LedgerService);
const dispatch = get(DispatchService);
const deskCouriers = [
  { phone: '07720000011', name: 'سيف', zone: 'zakur', held: 61_500, settled: 20_000 },
  { phone: '07720000012', name: 'أحمد', zone: 'hashimi', held: 34_000, settled: 0 },
  { phone: '07720000013', name: 'منتظر', zone: 'street_30', held: 82_000, settled: 15_000 },
  { phone: '07720000014', name: 'ياسر', zone: 'khamas', held: 12_500, settled: 0 },
];
let n = 0;
for (const c of deskCouriers) {
  const id = await person(c.phone, c.name, ['courier']);
  c.id = id;
  n += 1;
  if (n === 1) {
    // Saif's evening reads like a statement on his ledger page: five cash orders over three hours
    // and the 21:30 round in the middle (same totals as one line, so /finance is unchanged).
    const ago = (min) => new Date(Date.now() - min * 60_000);
    const runs = [[200, 12_500], [170, 9_750], [125, 18_250], [55, 14_000], [20, 27_000]];
    for (const [i, [min, amount]] of runs.entries())
      await ledger.record({ type: 'cash_collected', amount, fromAccount: `cash:${id}`, toAccount: `customer:${customers[(i + 2) % customers.length]}`, occurredAt: ago(min), idempotencyKey: `demo:cash:${id}:${i}` });
    await ledger.record({ type: 'driver_settlement', amount: c.settled, fromAccount: 'bank', toAccount: `cash:${id}`, occurredAt: ago(90), memo: `ops_round:D-DEMO-${n}`, idempotencyKey: `demo:settle:${id}` });
    continue;
  }
  await ledger.record({ type: 'cash_collected', amount: c.held + c.settled, fromAccount: `cash:${id}`, toAccount: `customer:${customers[n]}`, occurredAt: new Date(), idempotencyKey: `demo:cash:${id}` });
  if (c.settled) await ledger.record({ type: 'driver_settlement', amount: c.settled, fromAccount: 'bank', toAccount: `cash:${id}`, occurredAt: new Date(), memo: `ops_round:D-DEMO-${n}`, idempotencyKey: `demo:settle:${id}` });
}
// Muntadhar's licence runs out in 9 days: /drivers shows it under "أوراقه تنتهي".
{
  const m = deskCouriers[2];
  const doc = await accounts.uploadDocument(actor(m.id), { kind: 'licence', uploadId: await upload(m.id, await render(idCard('إجازة السياقة', m.name, '#7a9a5b'))), expiresAt: new Date(Date.now() + 9 * 86_400_000) });
  await accounts.reviewDocument(actor(haider), { documentId: doc.id, decision: 'approve', expiresAt: new Date(Date.now() + 9 * 86_400_000) });
}
const kareem = stores.find((s) => s.seed.key === 'haj_kareem') ?? stores[1];
await ledger.record({ type: 'merchant_payable', amount: 148_000, fromAccount: 'platform', toAccount: `merchant_cash:${khalid.orgId}`, occurredAt: new Date(), idempotencyKey: 'demo:payable:khalid' });
await ledger.record({ type: 'merchant_payable', amount: 312_500, fromAccount: 'platform', toAccount: `merchant_cash:${kareem.orgId}`, occurredAt: new Date(), idempotencyKey: 'demo:payable:kareem' });
await ledger.record({ type: 'merchant_paid_by_courier', amount: 26_000, fromAccount: `merchant_cash:${khalid.orgId}`, toAccount: `cash:${deskCouriers[0].id}`, occurredAt: new Date(), memo: 'handover-demo-1', idempotencyKey: 'demo:handover:1' });
await get(LedgerFacade).runNightly({ requestedBy: ali });

// Registry vehicles for the simulator's tuktuk and car drivers (checked by field ops), so the
// Console names them "حيدر ك. · تكتك · واسط 41373" (K-01). Bikes carry no registry plate.
const fleetRepo = get(FLEET_REPOSITORY);
let plateN = 0;
for (const d of await dispatch.liveDrivers('aziziyah', new Date())) {
  if (d.presence.vehicle === 'bike') continue;
  plateN += 1;
  const v = await fleetRepo.createVehicle({ plate: `واسط ${41000 + plateN * 373}`, vehicleClass: d.presence.vehicle, ownerOrgId: fleetOrg.id });
  await fleetRepo.reviewVehicle(v.id, { verified: true, by: haider, at: new Date(), note: null });
  await fleetRepo.setActiveDriver(v.id, d.presence.driverId);
}
const keepOnline = async () => {
  for (const c of deskCouriers.filter((x) => x.zone !== 'khamas')) {
    const pin = ZONE_PINS[c.zone] ?? { lat: 32.909, lng: 45.0635 };
    await dispatch.presence.online(c.id, { cityId: 'aziziyah', at: pin, zoneId: c.zone, vehicle: 'bike', tier: 'bronze', verticals: ['food'] }).catch(() => undefined);
  }
};
await keepOnline();
setInterval(() => void keepOnline(), 20_000).unref?.();

// ───────────────────────── SOS ─────────────────────────
// POST /demo/sos[?who=driver|customer] — someone on a live trip holds طوارئ: the red banner rings on
// every page and /safety opens the incident. The person gets an emergency contact first, and their
// phone keeps sending a fix every 5 s for two minutes (a short walk), so the trail and the contact's
// message show. Also run once at start-up when DEMO_SOS=1.
const { SafetyService } = await load('modules/safety/index.js');
const { TripsService } = await load('modules/trips/index.js');
const safety = get(SafetyService);
const trips = get(TripsService);
raiseDemoSos = async function raiseDemoSos(who = 'driver') {
  const live = (await trips.active('aziziyah')).filter((t) => t.courierId && t.stops.some((s) => s.orderId));
  const trip = live.find((t) => t.vertical === 'tuktuk' || t.vertical === 'taxi') ?? live[0];
  if (!trip) throw new Error('no live trip yet');
  const orderId = trip.stops.find((s) => s.orderId)?.orderId;
  const order = await get(OrdersService).get(orderId);
  const personId = who === 'customer' ? order.ordererId : trip.courierId;
  await identity.updateProfile(actor(personId), { emergencyContact: { name: who === 'customer' ? 'أم زينب' : 'أبو علي', phone: '07809990000' } });
  const fix = (await trips.lastPosition(trip.id))?.pin ?? { lat: 32.9095, lng: 45.0635 };
  const view = await safety.sos(actor(personId), { subject: { kind: 'trip', id: trip.id }, position: { ...fix, accuracyM: 9, at: new Date() }, clientId: `demo-sos-${Date.now()}`, pressedAt: new Date(Date.now() - 1200) });
  let i = 0;
  const walk = setInterval(() => {
    i += 1;
    if (i > 24) return clearInterval(walk);
    void safety.position(actor(personId), { incidentId: view.incidentId, position: { lat: fix.lat + i * 0.00011, lng: fix.lng - i * 0.00007 + (i % 3) * 0.00003, accuracyM: 6 + (i % 4), at: new Date() } }).catch(() => undefined);
  }, 5_000);
  walk.unref?.();
  return { incidentId: view.incidentId, personId, tripId: trip.id };
};
if (process.env.DEMO_SOS === '1') await raiseDemoSos().catch((err) => console.warn('demo sos skipped:', err?.message ?? err));

// ───────────────────────── خطوط sweep alert ─────────────────────────
// POST /demo/khat-sweep — a خطوط run ended 6 minutes ago and كرار has not confirmed the car is empty:
// the red row under the SOS banner (call him through the masked line). `?late=1`: he confirmed 9
// minutes after the last drop, the calm "تأكد متأخر 9 دقيقة" row. Written straight into the khat
// module's table (the run itself lives in the Partner demo; see apps/partner/scripts/demo/khat.mjs).
const { KHAT_REPOSITORY } = await load('modules/khat/index.js');
const khatRepo = get(KHAT_REPOSITORY);
const khatDriver = await person('07803330410', 'كرار عادل', ['khat_driver']);
people.khatDriver = { phone: '0780 333 0410', personId: khatDriver };
raiseDemoSweep = async function raiseDemoSweep(late = false) {
  const now = Date.now();
  const tripId = `trip_demo_khat_${now.toString(36)}`;
  const ended = new Date(now - (late ? 10 : 6) * 60_000);
  const { alert } = await khatRepo.raiseSweepAlert({ tripId, cityId: 'aziziyah', driverId: khatDriver, childrenTotal: 5, lastDropAt: ended, lastDropZone: 'centre', runEndedAt: ended, raisedAt: new Date(ended.getTime() + 5 * 60_000) });
  if (late) await khatRepo.confirmSweepAlert(tripId, new Date(ended.getTime() + 9 * 60_000 + 20_000));
  return { alertId: alert.id, tripId, driverId: khatDriver };
};

// ───────────────────────── الرجعة seat PIN alert ─────────────────────────
// POST /demo/pin-alert — a الرجعة car at كراج البوابة 1 leaving in 40 minutes, two riders booked
// (قدام and ورا يسار). The driver first types a PIN that is nobody's on the front seat, then the
// back-left rider's PIN on the front seat (refused: the cross-use row under the SOS banner), then
// the front rider's own PIN (he boards). `?kind=wrong`: three wrong PINs on the front seat. Real
// check-ins through the routes module, so the attempt history is the one ops would see.
const { DeparturesService } = await load('modules/routes/index.js');
const { AnnounceInput, HoldSeatInput } = await import(pathToFileURL(requireFromApi.resolve('@driver/contracts')).href);
const departures = get(DeparturesService);
let pinDemoN = 0;
raiseDemoPinAlert = async function raiseDemoPinAlert(kind = 'cross') {
  pinDemoN += 1;
  const tag = String(pinDemoN).padStart(2, '0');
  const driverId = await person(`078144404${tag}`, ['حيدر كاظم', 'مهدي صالح', 'عمار جبار'][pinDemoN % 3], ['intercity_driver']);
  const riderA = await person(`077155505${tag}`, 'رقية حسن');
  const riderB = await person(`077155506${tag}`, 'سجاد علي');
  const now = Date.now();
  const dep = await departures.announce(
    driverId,
    AnnounceInput.parse({ garageId: 'mp_garage_bab1', corridorId: 'aziziyah_baghdad', departAt: new Date(now + 40 * 60_000), latestDepartureAt: new Date(now + 70 * 60_000), vehicle: { kind: 'saloon', layout: 4, plate: `واسط ${52000 + pinDemoN}` } }),
  );
  const seat = async (riderId, seatId) => {
    const held = await departures.hold(riderId, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: [seatId] }, travellingAs: 'rijal' }));
    return departures.book(riderId, held.id, 'cash');
  };
  const a = await seat(riderA, 'front');
  const b = await seat(riderB, 'back_left');
  const nobody = ['0000', '1111', '2222', '3333', '4444', '5555'].filter((p) => p !== a.pin && p !== b.pin);
  const type = async (pin, bookingId) => {
    try {
      await departures.checkIn(driverId, dep.id, pin, bookingId);
    } catch (err) {
      if (err?.code !== 'pin_invalid') throw err;
    }
  };
  if (kind === 'wrong') for (const pin of nobody.slice(0, 3)) await type(pin, a.id);
  else {
    await type(nobody[0], a.id);
    await type(b.pin, a.id);
    await type(a.pin, a.id);
  }
  const attempts = await departures.pinAttempts(dep.id);
  return { departureId: dep.id, driverId, alertIds: attempts.filter((x) => x.alert).map((x) => x.id), attempts: attempts.map((x) => x.result) };
};

// الرجعة seats for the wall: a car at كراج البوابة 2 with 5 seats booked today, and (with the
// yesterday above) 3 of them as if booked yesterday at this time, so «مقاعد الرجعة» has a comparison.
{
  const now = Date.now();
  const driverId = await person('07814440300', 'جاسم محمد', ['intercity_driver']);
  const dep = await departures.announce(
    driverId,
    AnnounceInput.parse({ garageId: 'mp_garage_bab2', corridorId: 'aziziyah_baghdad', departAt: new Date(now + 3 * 3_600_000), latestDepartureAt: new Date(now + 3 * 3_600_000 + 30 * 60_000), vehicle: { kind: 'van', layout: 7, plate: 'واسط 61880' } }),
  );
  const seatIds = ['front', 'middle_left', 'middle_right', 'rear_left', 'rear_right', 'rear_middle', 'middle_middle'];
  const booked = [];
  for (let i = 0; i < (seedYesterday ? 7 : 4); i += 1) {
    const rider = await person(`07715550${String(300 + i).padStart(3, '0')}`, ['نور', 'حسين', 'فاطمة', 'مصطفى', 'زهراء', 'علي', 'مريم'][i]);
    const held = await departures.hold(rider, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: [seatIds[i]] }, travellingAs: 'rijal' }));
    booked.push(await departures.book(rider, held.id, 'cash'));
  }
  if (seedYesterday) {
    const { ROUTES_REPOSITORY } = await load('modules/routes/index.js');
    const routesRepo = get(ROUTES_REPOSITORY);
    for (const b of booked.slice(4)) {
      const rec = routesRepo.bookings?.get(b.id);
      if (rec) routesRepo.bookings.set(b.id, { ...rec, bookedAt: new Date(now - DAY_MS - 20 * 60_000) });
    }
  }
}

console.log(`DEMO ready on ${origin}/trpc · log in as 0770 000 0001 (علي)`);
