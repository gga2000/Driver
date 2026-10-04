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
// People (log in at /login with the phone; the dev OTP fills itself):
//   0770 000 0001  علي     admin + dispatcher + support + finance (sees and changes everything)
//   0770 000 0002  حيدر    field ops (took the photos, drafted the merchant: those are his own items)
//   0770 000 0003  زينب    support agent (10,000 a day refund limit)
// GET /demo/seed lists them.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);
const PORT = Number(process.env.PORT ?? 3395);
const SIM_SECONDS = Number(process.env.DEMO_SIM_SECONDS ?? 45);

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
async function upload(ownerId, bytes) {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: bytes.length });
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

const sim = get(SimulatorService);
await sim.start({ cityId: 'aziziyah', drivers: 24, ordersPerHour: 70, seed: 7, speed: 60 });
console.log(`simulator running ${SIM_SECONDS}s…`);
await new Promise((r) => setTimeout(r, SIM_SECONDS * 1000));

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

// ───────────────────────── approvals queue ─────────────────────────

const accounts = get(DriverAccountService);
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
  await ledger.record({ type: 'cash_collected', amount: c.held + c.settled, fromAccount: `cash:${id}`, toAccount: `customer:${customers[n]}`, occurredAt: new Date(), idempotencyKey: `demo:cash:${id}` });
  if (c.settled) await ledger.record({ type: 'driver_settlement', amount: c.settled, fromAccount: 'bank', toAccount: `cash:${id}`, occurredAt: new Date(), memo: `ops_round:D-DEMO-${n}`, idempotencyKey: `demo:settle:${id}` });
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

console.log(`DEMO ready on ${origin}/trpc · log in as 0770 000 0001 (علي)`);
