// Demo API for driving the customer app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp.
//
//   PORT=3200 node apps/customer/scripts/demo-api.mjs
//
// Seeds the four launch restaurants (مطعم خالد، مشويات الحاج كريم، مأكولات الشام، مطعم المسافر) and
// the demo-only food-door shops (كافيه دجلة، عصائر الربيع، حلويات الزهراء، آيس كريم الفرات) with
// their storefronts and menus — the same seed `pnpm db:seed` writes (@driver/contracts/seeds) — and
// plays the kitchen:
//   - an order a customer places is accepted after DEMO_KITCHEN_MS (default 20000; 0 = never);
//   - POST /demo/kitchen?orderId=<id>&action=accept|reject|partial  decides one order now (partial: its last dish
//     ran out — the customer has a minute to send the rest or cancel, BENCH-03);
//   - POST /demo/active-order?personId=<id>[&accept=0]  places and accepts (or not) a cash order from مطعم خالد for that
//     person, so home shows the pinned active-order pill with real API data;
//   - GET /demo/seed  lists the seeded restaurants with this process's org ids;
//   - GET /demo/market lists the seeded stalls and bakeries «السوق» with their org ids;
//   - POST /demo/popular  24 town orders at مطعم خالد so «الأكثر طلباً بالعزيزية» shows (joy o8);
//   - POST /demo/quiet?on=1|0  turns a quiet day (Console mourning day) on or off for today.
//   - POST /demo/night?on=1|0  the street asleep (/food after midnight): every kitchen closed now and opening at its
//     own morning hour; on=0 puts the real hours back.
//   - POST /demo/season?kind=ramadan|eid|off  a Ramadan or Eid period from today (J6 home card, checkout iftar slot).
// It also seeds and drives the other M3 customer flows (each section below documents its hooks):
//   - POST /demo/track?personId=…&scenario=…, /demo/track/advance   live order screen (/order/[id])
//   - POST /demo/history?personId=…                                 طلباتي: three past delivered orders
//   - POST /demo/usuals?personId=…, /demo/pot?key=…&item=…             joy J7a: usuals, «غدا الجمعة», «قدر اليوم» (pots + stories seeded)
//   - POST /demo/rajaa/claim|offers|topup|rode|outbound?personId=…            الرجعة boards (seeded at start; rode = «سافرت وياه قبل»)
//   - POST /demo/account?personId=…                                  places, wallet, household
//   - POST /demo/deals, /demo/topup/request|confirm, /demo/ops-agent      merchant deals at checkout, wallet top-up
//   - POST /demo/chat?personId=…&scenario=courier|merchant|ride|support|support_empty, /demo/chat/clock   chat + share-trip
//   - POST /demo/ride[?acceptMs=…], /demo/ride/accept|advance?orderId=…   taxi/tuktuk drivers for booking
//   - POST /demo/ride-for?personId=…                                 «لمنو المشوار؟»: trusted people and «ماما» booked for before
//   - POST /demo/gift?personId=…, /demo/invite?personId=…            «عزيمة» gift order, friends who took the invite (J7b)
//   - POST /demo/ride-habits?personId=…, /demo/dinner?personId=…[&kind=rajaa]   J7d: favourites, regular trips,
//                                                                     a booked ride, «عشاك يوصل وياك»
//   - POST /demo/same-ride?personId=…                                 step 4 o4: the «نفس مشوار البارحة؟» link
//   - POST /demo/rajaa-taxi?personId=…                               taxi ideas x2/x3/x4: a seat out of Aziziyah, a late
//                                                                     taxi to a car, three trips back (offer, armed, booked),
//                                                                     and n9: two cars back from Baghdad today
//   - POST /demo/rajaa-taxi?personId=…&baghdadSeat=1                  n9: only his seat on a car back from Baghdad
//   - POST /demo/booked-ride?personId=…[&state=looking|confirmed]    review #28: a ride booked for tomorrow 7:30,
//                                                                     drivers asked until 22:00 or حسين confirmed
//   - POST /demo/khat-bus?personId=…[&state=coming|away|…]           N14 «وين الباص»: a خطوط run for the first child
//   - POST /demo/parcels?personId=…                                  طرود: a parcel waiting for its door (link in the log),
//                                                                     one on the way, one delivered with its photos
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { avatarPng } from '../../../scripts/dev/demo-avatar.mjs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);

const { createApp } = await load('bootstrap.js');
const { OrdersService } = await load('modules/orders/index.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService, seedStorefronts } = await load('modules/catalog/index.js');
const { ControlsService } = await load('modules/controls/index.js');

const PORT = Number(process.env.PORT ?? 3200);
// طرود: the receiver's door link (`<base>/p/<token>`) points at the studio's customer web app in the demo.
process.env.SHARE_LINK_BASE_URL ??= 'http://localhost:8081';
const KITCHEN_MS = Number(process.env.DEMO_KITCHEN_MS ?? 20_000);
const app = await createApp();
// The studio opens every service so all screens stay reviewable; launch day itself is the city file's
// `launchedVerticals` (food, taxi, tuktuk). DEMO_LAUNCH_SCOPE=1 keeps the launch-day scope instead.
if (process.env.DEMO_LAUNCH_SCOPE !== '1') {
  const { ConfigService } = await load('modules/config/index.js');
  const config = app.get(ConfigService);
  config.setLaunchedVerticals('aziziyah', config.city('aziziyah').verticals.map((v) => v.vertical));
}

const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const orders = app.get(OrdersService);
const controls = app.get(ControlsService);

// The four launch kitchens, then the demo-only café, juice bar, sweets and ice cream shops so every food
// door has shops behind it (@driver/contracts/demo-shops; never in `pnpm db:seed`).
const { DEMO_SHOPS } = await import(pathToFileURL(fileURLToPath(new URL('../../../packages/contracts/dist/seeds/demo-shops.js', import.meta.url))).href);
const seeded = [...(await seedStorefronts(orgs, catalog, undefined, 'demo-owner')), ...(await seedStorefronts(orgs, catalog, DEMO_SHOPS, 'demo-owner'))];
// The shopping side «السوق» (2026-10-11): two produce stalls with today's and yesterday's prices, two
// bakeries (one paused for 30 minutes), all demo-only (never in `pnpm db:seed`).
const { ShoppingService, seedDemoShops } = await load('modules/shopping/index.js');
const marketShops = await seedDemoShops(orgs, catalog, app.get(ShoppingService), { ownerId: 'demo-owner' });
// Landmarks on the map (maps b3): a mosque, a market, a school… around the centre, شارع 30 and زاكور.
{
  const { PlacesService, seedDemoLandmarks } = await load('modules/places/index.js');
  await seedDemoLandmarks(app.get(PlacesService));
}
// Demo restaurants stay open around the clock so screens and shots work at any hour
// (DEMO_HOURS=real keeps the real opening hours, e.g. to show the "closed" states).
if (process.env.DEMO_HOURS !== 'real') {
  for (const s of seeded) {
    const front = await catalog.storefront(s.orgId);
    if (front && front.hours.length > 0) await catalog.saveStorefront({ ...front, hours: [] });
  }
}
await orgs.settled?.();
const khalid = seeded.find((s) => s.seed.key === 'khalid');
/** مطعم خالد's pin: the pickup for the live-order demo. */
const kitchen = khalid.seed.pin;
// «وياها كنافة؟» after a meal (food doors s7) needs a meal kitchen that makes a sweet. None of the four
// launch kitchens does, so in the demo only مطعم خالد bakes one kunafa tray (never in `pnpm db:seed`).
await catalog.upsertItem(
  khalid.orgId,
  { patch: { nameAr: 'كنافة', nameEn: 'Kunafa', description: 'جبن حار وقطر، تطلع من الفرن', priceIqd: 2000, categoryAr: 'حلو', sortOrder: 900, prepTimeMin: 5 } },
  'demo-owner',
);

/** Demo cars by their Iraqi name: a listed model by key (its picture draws under the seats), the rest `other`. */
const DEMO_MODEL_KEYS = { 'النترا': 'elantra', 'إلنترا': 'elantra', 'كورولا': 'corolla', 'سيراتو': 'cerato', 'سوناتا': 'sonata', 'أكسنت': 'accent' };
const demoModel = (name) => (DEMO_MODEL_KEYS[name] ? { modelKey: DEMO_MODEL_KEYS[name] } : { modelKey: 'other', model: name });

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

async function accept(orderId) {
  const accepted = await orders.merchantAccept('demo-staff', { orderId, prepMinutes: 20 });
  return orders.markPreparing('demo-staff', { orderId: accepted.id });
}

app.use('/demo/active-order', async (req, res) => {
  try {
    const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
    if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/active-order?personId=…' });
    const placed = await orders.place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [
        { catalogItemId: khalid.itemIds.get('liver_plate'), qty: 1 },
        { catalogItemId: khalid.itemIds.get('khalid_mix'), qty: 1 },
      ],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
    });
    // `&accept=0` leaves it waiting for the kitchen (the /kitchen/<id> screen and its notification ask).
    if (new URL(req.url ?? '/', 'http://x').searchParams.get('accept') === '0') return json(res, 200, { orderId: placed.id, state: placed.state, totalIqd: placed.totalIqd });
    const preparing = await accept(placed.id);
    json(res, 200, { orderId: preparing.id, state: preparing.state, totalIqd: preparing.totalIqd });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

app.use('/demo/market', (_req, res) => json(res, 200, marketShops));
app.use('/demo/seed', (_req, res) => json(res, 200, seeded.map((s) => ({ key: s.seed.key, orgId: s.orgId, name: s.seed.nameAr }))));

// Joy o8 «الأكثر طلباً بالعزيزية»: 24 town orders at مطعم خالد (scheduled for tomorrow, so they wait and
// never tie up couriers) — the mixed grill in every one, the liver plate in 22, lentil soup in 20, a
// Pepsi in 12: the restaurant page then lists the first three (20 orders is the line).
let popularSeeded = false;
app.use('/demo/popular', async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/popular' });
    if (!popularSeeded) {
      popularSeeded = true;
      const tomorrow = new Date(Date.now() + 20 * 3_600_000);
      for (let i = 0; i < 24; i++) {
        const lines = [{ catalogItemId: khalid.itemIds.get('khalid_mix'), qty: 1 }];
        if (i < 22) lines.push({ catalogItemId: khalid.itemIds.get('liver_plate'), qty: 1 });
        if (i < 20) lines.push({ catalogItemId: khalid.itemIds.get('lentil_soup'), qty: 1 });
        if (i % 2 === 0) lines.push({ catalogItemId: khalid.itemIds.get('pepsi'), qty: 1 });
        await orders.place(`demo-town-${i}`, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, lines, paymentMethod: 'cash', dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } }, scheduledFor: tomorrow });
      }
    }
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

app.use('/demo/kitchen', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const orderId = url.searchParams.get('orderId');
    const action = url.searchParams.get('action');
    if (req.method !== 'POST' || !orderId || !['accept', 'reject', 'partial'].includes(action ?? '')) return json(res, 400, { error: 'POST /demo/kitchen?orderId=…&action=accept|reject|partial' });
    const order =
      action === 'accept'
        ? await accept(orderId)
        : action === 'partial'
          ? await orders.merchantAccept('demo-staff', { orderId, prepMinutes: 20, unavailableLineIds: [(await orders.get(orderId)).lines.at(-1).id] })
          : await orders.merchantReject('demo-staff', { orderId, reason: 'المطبخ مزدحم' });
    json(res, 200, { orderId: order.id, state: order.state });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// Quiet day on or off for today (Baghdad date): no delivered burst, buzz or sounds in the app.
app.use('/demo/quiet', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/quiet?on=1|0' });
    const demoOps = { personId: 'demo-ops', sessionId: 'demo' };
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    for (const q of await controls.quietDays()) if (q.active) await controls.clearQuietDays(demoOps, { quietId: q.id });
    if (url.searchParams.get('on') === '1') await controls.setQuietDays(demoOps, { cityId: null, startsOn: today, endsOn: today, label_ar: 'يوم هادئ (تجربة)' });
    json(res, 200, await controls.season({ cityId: 'aziziyah' }));
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// The street asleep (food landing A2): every kitchen closes half an hour ago and opens again at its own
// usual hour, so /food shows the night look with real opening times; on=0 puts each kitchen's hours back.
const realHours = new Map();
app.use('/demo/night', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/night?on=1|0' });
    const on = url.searchParams.get('on') !== '0';
    const local = new Date(Date.now() + 3 * 3_600_000);
    const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
    const hhmm = (m) => { const v = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
    let i = 0;
    for (const s of seeded) {
      const front = await catalog.storefront(s.orgId);
      if (!front) continue;
      if (!realHours.has(s.orgId)) realHours.set(s.orgId, front.hours);
      // Seeded kitchens mostly have no hours on file: give those a usual morning one, 7:00 to 11:00.
      const opens = realHours.get(s.orgId)[0]?.start ?? ['07:00', '08:00', '09:00', '10:00', '11:00'][i % 5];
      const hours = on ? [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: opens, end: hhmm(nowMin - 30) })) : realHours.get(s.orgId);
      i++;
      await catalog.saveStorefront({ ...front, hours });
    }
    json(res, 200, { night: on, kitchens: i });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// Seasons (J6): a Ramadan or Eid period starting today (Baghdad date), or none. The home card, the
// timetable picker and checkout's «على الفطور» slot then show with today's real sun times.
app.use('/demo/season', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const kind = url.searchParams.get('kind') ?? 'off';
    if (req.method !== 'POST' || !['ramadan', 'eid', 'off'].includes(kind)) return json(res, 400, { error: 'POST /demo/season?kind=ramadan|eid|off' });
    const demoOps = { personId: 'demo-ops', sessionId: 'demo' };
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    const dayAfter = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    for (const s of await controls.seasons()) if (!s.clearedAt && s.kind !== 'quiet' && s.endsOn >= today) await controls.clearSeason(demoOps, { seasonId: s.id });
    if (kind === 'ramadan') await controls.setSeason(demoOps, { cityId: null, kind, startsOn: today, endsOn: dayAfter(29), label_ar: 'رمضان (تجربة)' });
    if (kind === 'eid') await controls.setSeason(demoOps, { cityId: null, kind, startsOn: today, endsOn: dayAfter(2), label_ar: 'العيد (تجربة)' });
    json(res, 200, await controls.season({ cityId: 'aziziyah' }));
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// The demo kitchen: accepts what customers place after KITCHEN_MS.
if (KITCHEN_MS > 0) {
  setInterval(async () => {
    try {
      const active = await orders.listActive({ cityId: 'aziziyah' });
      const now = Date.now();
      for (const o of active) {
        if (o.state === 'placed' && o.merchantOfferedAt && now - o.placedAt.getTime() >= KITCHEN_MS) await accept(o.id).catch(() => {});
      }
    } catch {
      /* the next tick tries again */
    }
  }, 1000).unref();
}

// ───────────────────────── live order screen demo (/order/[id]) ─────────────────────────
//
//   POST /demo/track?personId=<id>&scenario=<s>   → {orderId, tripId, courierId}
//   POST /demo/track/advance?orderId=<id>          → moves that demo order one step on
//
// Places a real order for the person, has the kitchen accept it, dispatches it to a fresh demo
// courier (online, named, verified today, with a plate) through the dispatcher override + his
// accept, then drives the real trips service to the scenario. While the courier is on the road a
// mover reports a position every 2 s along a path through Aziziyah, so the map shows him gliding.
// Scenarios: preparing · on_the_way · near · unreachable · arrived · late · signal_lost · reassigning.
// "الخردة علينا": `&tender=25000` places the order with "راح أدفع بـ 25,000" (the next note up when the
// total is above it); with `&nochange=1` the courier at the door has no change, takes the whole note
// and the rest lands in the customer's wallet (the arrival screen's coin strip, wallet "باقي الكاش").
const { tenderOptions } = await import('@driver/contracts');
// Scenarios: kitchen · preparing · on_the_way · near · at_door · unreachable · arrived · late · late_apology · late_credit · signal_lost · reassigning.
// Joy J5b: `kitchen` = the kitchen said yes, not cooking yet, no courier; then
//   POST /demo/track/kitchen?orderId=…&step=preparing|ready   the kitchen's next button (kitchen strip, l3)
//   POST /demo/track/assign?orderId=…[&rated=1]                a courier with a photo takes it now (driver reveal, l2)
// `&street=1` places the order «بالشارع» (the near/at-door cards ask him out to the street).
// `&rated=1` on any scenario gives its courier six rated past deliveries (the card's ★ rating).
// `late&pastPromiseMin=<n>` moves the promise <n> minutes into the past (the late banner's promise bar);
// `late_apology` puts it past the apology step (MoneyRules.latePromise.apologyAfterMin), so the order's next
// read (or the sweep) sends the one "آسفين، طلبك تأخر شوية" push and the banner says sorry;
// `late_credit` puts it past the honest-delay threshold, so the order's next read posts the credit.
// `late_traffic` (N6 «ليش متأخر»): `late_apology`, picked up and on the way, with the market street on
// his way home learned slow, so the route names a traffic stretch (`late_apology` itself shows the kitchen one).
const { IdentityService } = await load('modules/identity/index.js');
const { DispatchService } = await load('modules/dispatch/index.js');
const { TripsService } = await load('modules/trips/index.js');
const { COURIER_VEHICLES } = await load('modules/tracking/index.js');
const { EtaService } = await load('modules/routing/index.js');
const { decodePolyline } = await import('@driver/map');
const identity = app.get(IdentityService);
const dispatch = app.get(DispatchService);
const trips = app.get(TripsService);
const eta = app.get(EtaService);
const vehicles = app.get(COURIER_VEHICLES);

// Driver photos (Ali, 2026-10-06): every demo courier / driver has an approved main photo (a drawn
// portrait), so the driver cards, الرجعة offers and the share page show a face; some drivers keep the
// initial (`photo: false`) to show the fallback.
const { DriverAccountService } = await load('modules/driver-account/index.js');
const { BLOB_STORE: PHOTO_STORE } = await load('modules/places/index.js');
async function giveMainPhoto(personId, seed) {
  const bytes = avatarPng(seed);
  const store = app.get(PHOTO_STORE);
  const ticket = await store.createUpload({ ownerId: personId, contentType: 'image/png', sizeBytes: bytes.length });
  const u = new URL(ticket.uploadUrl, 'http://x');
  await store.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
  const account = app.get(DriverAccountService);
  const sent = await account.setMainPhoto({ personId, sessionId: 'demo' }, { uploadId: ticket.uploadId });
  await account.reviewDocument({ personId: 'demo-field-ops', sessionId: 'demo' }, { documentId: sent.latest.documentId, decision: 'approve' });
}

const HOME = { lat: 32.887, lng: 45.0765 };
/** Kitchen → home along a plausible street line (draft; no road graph yet). */
const TO_HOME = [kitchen, { lat: 32.9052, lng: 45.0641 }, { lat: 32.9008, lng: 45.0668 }, { lat: 32.8961, lng: 45.0709 }, { lat: 32.8912, lng: 45.0738 }, HOME];
/** From the north of town to the kitchen (courier coming to pick up). */
const TO_KITCHEN = [{ lat: 32.9215, lng: 45.0598 }, { lat: 32.9172, lng: 45.0611 }, { lat: 32.9131, lng: 45.0622 }, kitchen];
/** Far edge of town (the "running late" courier). */
const FAR_TO_KITCHEN = [{ lat: 32.9405, lng: 45.0445 }, { lat: 32.9302, lng: 45.0521 }, { lat: 32.9198, lng: 45.0589 }, kitchen];
const NAMES = ['حيدر كاظم', 'مصطفى جاسم', 'عباس فاضل', 'علي حسين', 'كرار عادل', 'مرتضى سالم', 'سجاد ناصر'];
const PLATES = ['واسط 45678', 'واسط 31207', 'بغداد 88412', 'واسط 50923', 'واسط 17760', 'واسط 62094', 'واسط 24518'];
let courierSeq = 0;
const movers = new Map(); // tripId → interval
const demos = new Map(); // orderId → {tripId, courierId, step}

function bearing(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function metres(a, b) {
  const k = 111_320;
  const dx = (b.lng - a.lng) * k * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, (b.lat - a.lat) * k);
}

async function newCourier(at, { photo = null } = {}) {
  courierSeq += 1;
  const phone = `07712${String(340000 + courierSeq).padStart(6, '0')}`;
  await identity.requestOtp({ phone, purpose: 'login' });
  const { code } = await identity.devLastOtp(phone);
  const courierId = (await identity.verifyOtp({ phone, code })).personId;
  await identity.grantRole({ personId: 'system:demo' }, { personId: courierId, kind: 'courier' });
  await identity.setName({ personId: courierId, sessionId: 'demo' }, NAMES[(courierSeq - 1) % NAMES.length]);
  // Every other courier has his approved photo; the rest show the initial (the fallback).
  if (photo ?? courierSeq % 2 === 1) await giveMainPhoto(courierId, `courier:${courierSeq}`);
  vehicles.register?.(courierId, { vehicleClass: 'bike', plate: PLATES[(courierSeq - 1) % PLATES.length] });
  await dispatch.presence.online(courierId, { cityId: 'aziziyah', at, vehicle: 'bike', tier: 'silver' });
  return courierId;
}

function stopMover(tripId) {
  clearInterval(movers.get(tripId));
  movers.delete(tripId);
}

/**
 * Reports a fix every 2 s, `stepM` metres further along `path` (stops at the end). With road routing on
 * (OSRM_URL), the courier drives the routed road between the path's ends instead — the same road the
 * app draws — so the demo shows him following the streets.
 */
async function startMover(tripId, courierId, drawn, stepM = 38) {
  stopMover(tripId);
  const road = await eta.path([drawn[0], drawn[drawn.length - 1]]).catch(() => null);
  const path = road?.polyline6 ? decodePolyline(road.polyline6) : drawn;
  let seg = 0;
  let pos = { ...path[0] };
  const report = async (at = new Date()) => {
    const next = path[Math.min(seg + 1, path.length - 1)];
    await trips.reportPosition(courierId, { tripId, pin: pos, at, bearing: Math.round(bearing(pos, next)), speedKmh: 24 });
    await dispatch.presence.heartbeat(courierId, pos).catch(() => undefined);
  };
  await report();
  movers.set(
    tripId,
    setInterval(() => {
      let left = stepM;
      while (left > 0 && seg < path.length - 1) {
        const to = path[seg + 1];
        const d = metres(pos, to);
        if (d <= left) {
          pos = { ...to };
          seg += 1;
          left -= d;
        } else {
          const k = left / d;
          pos = { lat: pos.lat + (to.lat - pos.lat) * k, lng: pos.lng + (to.lng - pos.lng) * k };
          left = 0;
        }
      }
      report().catch((e) => console.error('mover', e.message));
      if (seg >= path.length - 1) stopMover(tripId);
    }, 2000),
  );
}

async function placeAccepted(personId, prepMinutes, dropoff = { zoneKey: 'zakur', pin: HOME }, tender = null, { cooking = true, street = false, accept = true } = {}) {
  const input = {
    cityId: 'aziziyah',
    type: 'food',
    merchantOrgId: khalid.orgId,
    lines: [
      // Items without required choices, under the new-customer cash cap (25,000 incl. fees).
      { catalogItemId: khalid.itemIds.get('liver_plate'), qty: 2 },
      { catalogItemId: khalid.itemIds.get('salad'), qty: 1 },
      { catalogItemId: khalid.itemIds.get('pepsi'), qty: 2 },
      // To the saved home (the arrival demo): a soup too, so a running 20 % deal leaves change for the wallet.
      ...(dropoff.pin !== HOME ? [{ catalogItemId: khalid.itemIds.get('lentil_soup'), qty: 1 }] : []),
    ],
    paymentMethod: 'cash',
    dropoff,
    // `&street=1`: placed «بالشارع» (HUNT-02), the server's −250 and `streetHandover` on the order.
    ...(street ? { options: { streetHandover: true } } : {}),
  };
  let statedTenderIqd;
  if (tender) {
    const { totalIqd } = await orders.quote(personId, input);
    statedTenderIqd = tender >= totalIqd ? tender : tenderOptions(totalIqd)[1];
  }
  const placed = await orders.place(personId, { ...input, ...(statedTenderIqd ? { statedTenderIqd } : {}) });
  if (!accept) return placed.id;
  await orders.merchantAccept('demo-staff', { orderId: placed.id, prepMinutes });
  if (cooking) await orders.markPreparing('demo-staff', { orderId: placed.id });
  return placed.id;
}

/** Dispatcher hands the trip to the courier; he accepts through dispatch (the real path). */
async function assign(orderId, courierId, { force = false } = {}) {
  const trip = await trips.activeForOrder(orderId);
  if (!trip) throw new Error(`no trip for ${orderId}`);
  const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: courierId, reason: 'demo', ...(force ? { force: true } : {}) });
  await dispatch.respond({ personId: courierId, sessionId: 'demo' }, { offerId, accept: true });
  return trip.id;
}

/**
 * Joy l2: past deliveries for a courier, each rated by a different customer, so his card carries the
 * rating customers see (shown from 5 ratings). `force` lets a taxi/tuktuk driver carry them (demo only).
 */
let raterSeq = 0;
async function ratedHistory(courierId, { scores = [5, 5, 4, 5, 5, 5], force = false } = {}) {
  for (const score of scores) {
    raterSeq += 1;
    const personId = `demo-rater-${raterSeq}`;
    const placed = await orders.place(personId, { cityId: 'aziziyah', type: 'food', merchantOrgId: khalid.orgId, lines: [{ catalogItemId: khalid.itemIds.get('liver_plate'), qty: 1 }], paymentMethod: 'cash', dropoff: { zoneKey: 'zakur', pin: HOME } });
    await accept(placed.id);
    const tripId = await assign(placed.id, courierId, { force });
    await orders.markReady('demo-staff', { orderId: placed.id });
    const pickup = await stopOf(tripId, 'pickup');
    await trips.arrive(tripId, pickup.id, courierId, { pin: kitchen });
    await trips.completeStop(tripId, pickup.id, courierId);
    const drop = await stopOf(tripId, 'dropoff');
    await trips.arrive(tripId, drop.id, courierId, { pin: HOME });
    const o = await orders.get(placed.id);
    await trips.completeStop(tripId, drop.id, courierId, { handover: { cashCollectedIqd: o.totalIqd } });
    await orders.rate(personId, { orderId: placed.id, delivery: score, food: 5 });
  }
}

async function stopOf(tripId, type) {
  return (await trips.get(tripId)).stops.find((s) => s.type === type);
}

/** One step on: preparing → picked up (on the way) → at the door → delivered. */
async function advance(orderId, { move = true } = {}) {
  const d = demos.get(orderId);
  if (!d) throw new Error(`not a demo order: ${orderId}`);
  const { tripId, courierId } = d;
  if (d.step === 'preparing' || d.step === 'late') {
    stopMover(tripId);
    await orders.markReady('demo-staff', { orderId });
    const pickup = await stopOf(tripId, 'pickup');
    if (move) await trips.reportPosition(courierId, { tripId, pin: kitchen, at: new Date(), bearing: 160, speedKmh: 0 });
    await trips.arrive(tripId, pickup.id, courierId, { pin: kitchen });
    await trips.completeStop(tripId, pickup.id, courierId);
    if (move) await startMover(tripId, courierId, TO_HOME);
    d.step = 'on_the_way';
  } else if (d.step === 'on_the_way') {
    stopMover(tripId);
    const drop = await stopOf(tripId, 'dropoff');
    const door = d.door ?? HOME;
    await trips.reportPosition(courierId, { tripId, pin: door, at: new Date(), bearing: 135, speedKmh: 0 });
    await trips.arrive(tripId, drop.id, courierId, { pin: door });
    d.step = 'at_door';
  } else if (d.step === 'at_door' || d.step === 'unreachable') {
    const drop = await stopOf(tripId, 'dropoff');
    const order = await orders.get(orderId);
    const note = d.noChange ? order.statedTenderIqd : null;
    const extra = note ? note - order.totalIqd : 0;
    // No change on him: the whole note, the rest to the customer's wallet (cap 25,000).
    const handover = extra > 0 && extra <= 25_000 ? { cashCollectedIqd: note, changeToWalletIqd: extra } : { cashCollectedIqd: order.totalIqd };
    await trips.completeStop(tripId, drop.id, courierId, { handover });
    d.step = 'arrived';
  }
  return d.step;
}

/** The person's saved home with a gate photo (POST /demo/account adds one), for the arrival screen (C-11). */
async function savedHome(personId) {
  const { SavedPlacesService } = await load('modules/places/index.js');
  const mine = await app.get(SavedPlacesService).mine(personId);
  return mine.find((p) => p.label === 'home' && p.photos.length > 0) ?? null;
}

/**
 * Audit d-5 demo: moves an order's kitchen times back so its promised arrival was `minutes` ago (the
 * in-memory record only), so the late banner's promise bar — and past the threshold the credit — show.
 */
async function pastPromise(personId, orderId, minutes) {
  const { TrackingService } = await load('modules/tracking/index.js');
  const { ORDERS_REPOSITORY } = await load('modules/orders/index.js');
  const view = await app.get(TrackingService).track({ personId, sessionId: 'demo' }, { orderId });
  if (!view.promisedAt) return;
  const shift = view.promisedAt.getTime() - Date.now() + minutes * 60_000;
  const order = await orders.get(orderId);
  const back = (d) => (d ? new Date(d.getTime() - shift) : d);
  await app.get(ORDERS_REPOSITORY).update(orderId, { promisedReadyAt: back(order.promisedReadyAt), acceptedAt: back(order.acceptedAt), preparingAt: back(order.preparingAt) });
}

async function scenario(personId, name, opts = {}) {
  if (name === 'late_traffic') {
    const r = await scenario(personId, 'late_apology');
    // Picked up and standing at the start of the way home, so the whole road ahead is on the map.
    await advance(r.orderId, { move: false });
    await trips.reportPosition(r.courierId, { tripId: r.tripId, pin: TO_HOME[1], at: new Date(), bearing: 150, speedKmh: 0 });
    // The demo only: legs starting near the middle of the way home run 1.6× the router (a learned jam).
    const jam = TO_HOME[3];
    const eta = app.get(EtaService);
    eta.factor = async (from) => (Math.hypot(from.lat - jam.lat, (from.lng - jam.lng) * 0.84) < 0.006 ? 1.6 : 1);
    return r;
  }
  if (name === 'late_credit' || name === 'late_apology') {
    // Past one of the honest-delay promise's steps (MoneyRules.latePromise): the next read sends the
    // apology (+ apologyAfterMin) or posts the credit (+ afterMin; the apology went out on the way).
    const { AZIZIYAH_MONEY_RULES } = await import('@driver/contracts');
    const r = await scenario(personId, 'late');
    const rules = AZIZIYAH_MONEY_RULES.latePromise;
    await pastPromise(personId, r.orderId, (name === 'late_credit' ? rules.afterMin : rules.apologyAfterMin) + 1);
    return r;
  }
  if (name === 'placed') {
    // Sent and not yet accepted: the kitchen-waiting screen (/kitchen/[id]) with its ring.
    return { orderId: await placeAccepted(personId, 20, undefined, null, { accept: false }) };
  }
  if (name === 'kitchen') {
    // Joy l3/l2: the kitchen said yes and has not started; no courier yet. /demo/track/kitchen moves
    // the kitchen on, /demo/track/assign brings the courier (the reveal plays on an open screen).
    const orderId = await placeAccepted(personId, 20, undefined, opts.tender ?? null, { cooking: false });
    demos.set(orderId, { tripId: null, courierId: null, step: 'kitchen', door: null, noChange: false });
    return { orderId };
  }
  const late = name === 'late';
  // "arrived" goes to the person's own home when it has a gate photo, so the arrival shows that door.
  const home = name === 'arrived' ? await savedHome(personId) : null;
  const orderId = await placeAccepted(personId, late ? 1 : 20, home ? { zoneKey: home.zoneId, pin: home.pin } : undefined, opts.tender ?? null, { street: Boolean(opts.street) });
  const start = late ? FAR_TO_KITCHEN[0] : TO_KITCHEN[0];
  const courierId = await newCourier(start);
  if (opts.rated) await ratedHistory(courierId);
  const tripId = await assign(orderId, courierId);
  const d = { tripId, courierId, step: late ? 'late' : 'preparing', door: home?.pin ?? null, noChange: Boolean(opts.noChange) };
  demos.set(orderId, d);
  if (name === 'preparing' || late) {
    await startMover(tripId, courierId, late ? FAR_TO_KITCHEN : TO_KITCHEN, late ? 22 : 30);
    if (late && opts.pastPromiseMin) await pastPromise(personId, orderId, opts.pastPromiseMin);
    return { orderId, tripId, courierId };
  }
  if (name === 'reassigning') {
    await trips.reportPosition(courierId, { tripId, pin: start, at: new Date(), bearing: 170, speedKmh: 20 });
    await trips.detachOrder(tripId, orderId, 'demo-dispatcher', 'reassigned');
    d.step = 'reassigning';
    return { orderId, tripId, courierId };
  }
  if (name === 'signal_lost') {
    // Picked up, one fix two minutes ago on the way, then silence.
    await advance(orderId, { move: false });
    await trips.reportPosition(courierId, { tripId, pin: TO_HOME[3], at: new Date(Date.now() - 125_000), bearing: 150, speedKmh: 22 });
    return { orderId, tripId, courierId };
  }
  await advance(orderId); // picked up, mover on the way home
  if (name === 'on_the_way') return { orderId, tripId, courierId };
  if (name === 'near') {
    // A few streets from the door: he crosses the "almost there" line within seconds.
    await startMover(tripId, courierId, TO_HOME.slice(3), 30);
    return { orderId, tripId, courierId };
  }
  await advance(orderId); // at the door
  if (name === 'at_door') return { orderId, tripId, courierId };
  if (name === 'unreachable') {
    // He waits a little up the street (joy f18: «حيدر واقف هنا · 40 متر من بابك»).
    const door = d.door ?? HOME;
    await trips.reportPosition(courierId, { tripId, pin: { lat: door.lat + 40 / 111_320, lng: door.lng }, at: new Date(), bearing: 180, speedKmh: 0 });
    const drop = await stopOf(tripId, 'dropoff');
    await trips.startUnreachable(tripId, drop.id, courierId);
    d.step = 'unreachable';
    return { orderId, tripId, courierId };
  }
  await advance(orderId); // delivered
  return { orderId, tripId, courierId };
}

const SCENARIOS = new Set(['placed', 'kitchen', 'preparing', 'on_the_way', 'near', 'at_door', 'unreachable', 'arrived', 'late', 'late_apology', 'late_credit', 'late_traffic', 'signal_lost', 'reassigning']);

app.use('/demo/track', async (req, res) => {
  try {
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('{"error":"POST"}');
      return;
    }
    if (url.pathname.endsWith('/kitchen')) {
      // Joy l3: the kitchen presses its next button — «بدأنا» (preparing) or «جاهز» (ready).
      const orderId = url.searchParams.get('orderId');
      const step = url.searchParams.get('step') ?? 'preparing';
      if (step === 'ready') await orders.markReady('demo-staff', { orderId });
      else await orders.markPreparing('demo-staff', { orderId });
      res.end(JSON.stringify({ orderId, state: (await orders.get(orderId)).state }));
      return;
    }
    if (url.pathname.endsWith('/assign')) {
      // Joy l2: a courier (with his approved photo; `rated=1` → six rated past deliveries) takes the order now.
      const orderId = url.searchParams.get('orderId');
      const courierId = await newCourier(TO_KITCHEN[0], { photo: true });
      if (url.searchParams.get('rated') === '1') await ratedHistory(courierId);
      const tripId = await assign(orderId, courierId);
      const d = demos.get(orderId) ?? { door: null, noChange: false };
      demos.set(orderId, { ...d, tripId, courierId, step: 'preparing' });
      await startMover(tripId, courierId, TO_KITCHEN, 30);
      res.end(JSON.stringify({ orderId, tripId, courierId }));
      return;
    }
    if (url.pathname.endsWith('/advance')) {
      const orderId = url.searchParams.get('orderId');
      res.end(JSON.stringify({ orderId, step: await advance(orderId) }));
      return;
    }
    const personId = url.searchParams.get('personId');
    const name = url.searchParams.get('scenario') ?? 'on_the_way';
    if (!personId || !SCENARIOS.has(name)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `POST /demo/track?personId=…&scenario=${[...SCENARIOS].join('|')}` }));
      return;
    }
    const tender = Number(url.searchParams.get('tender') ?? 0) || null;
    const noChange = url.searchParams.get('nochange') === '1';
    const pastPromiseMin = Number(url.searchParams.get('pastPromiseMin') ?? 0);
    const rated = url.searchParams.get('rated') === '1';
    const street = url.searchParams.get('street') === '1';
    res.end(JSON.stringify({ scenario: name, ...(await scenario(personId, name, { tender, noChange, pastPromiseMin, rated, street })) }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.stack ?? err) }));
  }
});

// ───────────────────────── order history (طلباتي, audit C-15) ─────────────────────────
//
//   POST /demo/history?personId=<id>   → {orderIds}
//
// Three delivered food orders from three kitchens, placed yesterday, three days ago and nine days
// ago (the in-memory record is back-dated after delivery), one of them rated. Then حمص at
// مشويات الحاج كريم runs out, so "اطلبه مرة ثانية" on that order shows what can't come back.
const HISTORY = [
  { key: 'haj_kareem', daysAgo: 1, lines: [['rice_bamia', 2], ['hummus', 1], ['erbil_laban', 2]] },
  { key: 'sham', daysAgo: 3, rate: true, lines: [['arabi_shawarma', 1], ['falafel_plate', 1], ['lemon_mint', 2]] },
  { key: 'khalid', daysAgo: 9, lines: [['liver_plate', 1], ['salad', 1], ['pepsi', 2]] },
];

async function deliveredOrder(personId, h) {
  const r = seeded.find((s) => s.seed.key === h.key);
  const placed = await orders.place(personId, {
    cityId: 'aziziyah',
    type: 'food',
    merchantOrgId: r.orgId,
    lines: h.lines.map(([k, qty]) => ({ catalogItemId: r.itemIds.get(k), qty })),
    paymentMethod: h.householdOrgId ? 'wallet' : 'cash',
    ...(h.householdOrgId ? { householdOrgId: h.householdOrgId } : {}),
    ...(h.familyTable ? { familyTable: true } : {}),
    dropoff: { zoneKey: 'zakur', pin: h.pin ?? HOME },
  });
  await accept(placed.id);
  const courierId = await newCourier(r.seed.pin);
  const tripId = await assign(placed.id, courierId);
  await orders.markReady('demo-staff', { orderId: placed.id });
  const pickup = await stopOf(tripId, 'pickup');
  await trips.arrive(tripId, pickup.id, courierId, { pin: r.seed.pin });
  await trips.completeStop(tripId, pickup.id, courierId);
  const drop = await stopOf(tripId, 'dropoff');
  await trips.arrive(tripId, drop.id, courierId, { pin: h.pin ?? HOME });
  const order = await orders.get(placed.id);
  await trips.completeStop(tripId, drop.id, courierId, { handover: h.householdOrgId ? {} : { cashCollectedIqd: order.totalIqd } });
  if (h.rate) await orders.rate(personId, { orderId: placed.id, delivery: 5, food: 5 });
  // Back-date (in-memory repository only): the list then shows "أمس" and older days.
  const rec = orders.repo?.orders?.get?.(placed.id);
  if (rec) {
    const shift = h.daysAgo * 86_400_000;
    for (const f of ['placedAt', 'acceptedAt', 'preparingAt', 'readyAt', 'pickedUpAt', 'deliveredAt', 'closedAt', 'merchantOfferedAt', 'promisedReadyAt']) {
      if (rec[f] instanceof Date) rec[f] = new Date(rec[f].getTime() - shift);
    }
  }
  return placed.id;
}

app.use('/demo/history', async (req, res) => {
  try {
    const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
    if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/history?personId=…' });
    const orderIds = [];
    const haj = seeded.find((s) => s.seed.key === 'haj_kareem');
    // Back on the menu for the order itself (a second call would otherwise find it sold out).
    await catalog.setAvailability(haj.orgId, haj.itemIds.get('hummus'), true);
    for (const h of HISTORY) orderIds.push(await deliveredOrder(personId, h));
    await catalog.setAvailability(haj.orgId, haj.itemIds.get('hummus'), false);
    json(res, 200, { orderIds });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// ───────────────────────── joy J7a: food habits ─────────────────────────
// Seeded at start (demo data, not the real seed: a pot is today's, a story needs the owner's yes):
//   «قدر اليوم» at مشويات الحاج كريم (تمن وبامية, «ويا لحم غنم») and مطعم المسافر (دولمة, until 22:00),
//   and two kitchen stories shown on the restaurant page (مطعم خالد, مشويات الحاج كريم).
// Hooks:
//   POST /demo/usuals?personId=…   two delivered orders of the same meal a week and two weeks ago at this
//                                   hour (home: «طلبك المعتاد؟»), and the same lunch on the last two
//                                   Fridays at 13:30 (Thursday evening / Friday morning: «باچر الجمعة»;
//                                   open the web build with `?now=<Thursday>T20:00:00+03:00`)
//   POST /demo/pot?key=haj_kareem&item=rice_fasoulia[&clear=1]   posts (or clears) a kitchen's pot the
//                                   way the Merchant app does; followers get the «قدر اليوم» push
const { EventsService } = await load('modules/events/index.js');
const events = app.get(EventsService);
const byKey = (key) => seeded.find((s) => s.seed.key === key);

async function demoPot(key, item, note = null, until = null) {
  const r = byKey(key);
  const { pot, item: dish, followerIds } = await catalog.postPot(r.orgId, { itemId: r.itemIds.get(item), note, until }, 'demo-owner');
  await events.emit(undefined, { actorId: 'demo-owner', type: 'catalog.pot_posted', occurredAt: new Date(), payload: { merchantOrgId: r.orgId, itemId: dish.id, dishName: dish.nameAr, restaurantName: r.seed.nameAr, localDate: pot.localDate, note, until, followerIds } }, { name: 'org', id: r.orgId });
  return pot;
}
await demoPot('haj_kareem', 'rice_bamia', 'ويا لحم غنم');
await demoPot('musafir', 'dolma', null, '22:00');
await catalog.setStory(byKey('khalid').orgId, { text: 'نشوي على الفحم من أيام أبوي، ونفس الخلطة.\nالكباب ينگطع بالساطور كل صبح.', sinceYear: 2009, shown: true });
await catalog.setStory(byKey('haj_kareem').orgId, { text: 'الحاج كريم بدأ بمنقلة وحدة بالسوق. هسة ولده واقف على نفس المنقلة.', sinceYear: 1998, shown: true });
// «مميّز» (Ali, 2026-10-12): الحاج كريم is on the featured tier in the demo, so the stamp shows and he sits first.
await orgs.setMerchantSettings(byKey('haj_kareem').orgId, { commissionTier: 'featured' });

app.use('/demo/pot', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const key = url.searchParams.get('key') ?? 'haj_kareem';
    if (req.method !== 'POST' || !byKey(key)) return json(res, 400, { error: 'POST /demo/pot?key=<kitchen>&item=<dish>[&clear=1]' });
    if (url.searchParams.get('clear') === '1') {
      await catalog.clearPot(byKey(key).orgId);
      return json(res, 200, { cleared: key });
    }
    const pot = await demoPot(key, url.searchParams.get('item') ?? 'rice_bamia', url.searchParams.get('note'), url.searchParams.get('until'));
    json(res, 200, { pot });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

/** The last `n`-th Friday before now, at 13:30 Baghdad, as days ago (fractional) for `deliveredOrder`. */
function fridayDaysAgo(n) {
  const nowMs = Date.now();
  const local = new Date(nowMs + 3 * 3_600_000);
  const back = ((local.getUTCDay() - 5 + 7) % 7 || 7) + 7 * (n - 1);
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back, 13, 30) - 3 * 3_600_000;
  return (nowMs - target) / 86_400_000;
}

app.use('/demo/usuals', async (req, res) => {
  try {
    const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
    if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/usuals?personId=…' });
    const orderIds = [];
    for (const daysAgo of [14, 7]) orderIds.push(await deliveredOrder(personId, { key: 'haj_kareem', daysAgo, lines: [['rice_bamia', 2], ['erbil_laban', 2]] }));
    for (const n of [2, 1]) orderIds.push(await deliveredOrder(personId, { key: 'musafir', daysAgo: fridayDaysAgo(n), lines: [['dolma', 1], ['quzi', 1]] }));
    json(res, 200, { orderIds });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

// ───────────────────────── الرجعة (intercity) demo ─────────────────────────
// Departures on both sides of both corridors (one nearly full with the front taken and a back
// middle seat that a woman can't take between two men, a van with a walk-up, a family-only SUV,
// a car with its front seat sold), demand posts behind the board banner, and three dev hooks:
//   POST /demo/rajaa/claim?personId=…    announce a car inside that person's open أريد أرجع window
//   POST /demo/rajaa/offers?personId=…   seven drivers open that person's requests and five offer
//   POST /demo/rajaa/history             finished private trips to Najaf (the usual range, p1)
//   POST /demo/rajaa/waiting?personId=…&min=…[&charged=1]   the picked driver is waiting (w2 clock)
//   POST /demo/rajaa/topup?personId=…&amount=…   credit the wallet (request-board deposit)
//   POST /demo/rajaa/agreements?personId=…&departureId=…   the driver prices his asks (step 4 agreed prices)
//   POST /demo/rajaa/cash?personId=…&answer=accept|decline|ask|none[&owe=…]   «احجز وادفع كاش» (step 4b, demo switch on)
//   POST /demo/rajaa/share?personId=…&as=booker|friend[&joined=1][&open=0][&postId=…][&arrived=1][&board=self|driver]   share a private car by link (step 6, demo switch on; way C boarding)
//   POST /demo/rajaa/return?personId=…   a seat out and two cars back: «رايح وراجع» 10 % (step 5, demo switch on)
//   POST /demo/rajaa/road?bookingId=…&km=52[&ageMin=…]   N13 «طريق بغداد»: a departed car put km along the real road
// الرجعة drivers are real people in this demo (identity persons with a name), so the board, seat
// sheet and boarding pass show "سايقك حيدر" from `routes.driverCards` (audit C-19), not an ID code.
const DRIVER_NAMES = {
  drv_1Q7Z: 'حيدر كاظم',
  drv_2X8P: 'مصطفى جاسم',
  drv_3C5N: 'عباس فاضل',
  drv_4M9T: 'كرار عادل',
  drv_5R1D: 'مرتضى سالم',
  drv_6J2L: 'سجاد ناصر',
  drv_7K2Q: 'علي حسن',
  drv_8T6W: 'حسين عبد الله',
  drv_9B3H: 'أحمد كريم',
};
let driverPhoneSeq = 0;
const D = {};
for (const [code, name] of Object.entries(DRIVER_NAMES)) {
  driverPhoneSeq += 1;
  const phone = `07719${String(880000 + driverPhoneSeq).padStart(6, '0')}`;
  await identity.requestOtp({ phone, purpose: 'login' });
  const { code: otp } = await identity.devLastOtp(phone);
  const id = (await identity.verifyOtp({ phone, code: otp })).personId;
  await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'intercity_driver' });
  await identity.setName({ personId: id, sessionId: 'demo' }, name);
  if (driverPhoneSeq !== 2) await giveMainPhoto(id, `rajaa:${code}`);
  D[code] = id;
}

const rajaa = await (async () => {
  const { DeparturesService, DemandService, RequestBoardService } = await load('modules/routes/index.js');
  const { LedgerService } = await load('modules/ledger/index.js');
  const deps = app.get(DeparturesService);
  const demand = app.get(DemandService);
  const requests = app.get(RequestBoardService);
  const ledger = app.get(LedgerService);
  const MIN = 60_000;
  // Round "now" up to 5 minutes so board times read like a garage sign (5:35, not 5:37).
  const t0 = Math.ceil((Date.now() + 2 * MIN) / (5 * MIN)) * 5 * MIN;
  const at = (min) => new Date(t0 + min * MIN);
  let riderSeq = 0;
  const rider = () => `demo-rider-${++riderSeq}`;

  async function announce(driverId, { garageId, corridorId = 'aziziyah_baghdad', inMin, latestMin = 45, vehicle, familyOnly = false }) {
    return deps.announce(driverId, {
      garageId,
      corridorId,
      departAt: at(inMin),
      latestDepartureAt: at(inMin + latestMin),
      vehicle,
      familyOnly,
    });
  }
  async function seat(dep, seatIds, travellingAs) {
    const b = await deps.hold(rider(), {
      departureId: dep.id,
      selection: { kind: 'seats', seatIds },
      travellingAs,
      pickup: { kind: 'garage' },
      largeBags: false,
    });
    await deps.book(b.riderId, b.id, 'cash');
  }
  // A listed model draws the driver's own car under the seats (Ali, 2026-10-07); anything else is `other` by name.
  const saloon = (plate, model, color) => ({ kind: 'saloon', layout: 4, plate, ...demoModel(model), color });

  // ── The drivers' records (x12–x17): finished runs back-dated over the past months, rated by their
  // riders, some with a line. Each run goes through the real service (announce → book → check in →
  // depart → arrive → rate); only the dates are moved back afterwards (in-memory repository only).
  const { ROUTES_REPOSITORY } = await load('modules/routes/index.js');
  const routesRepo = app.get(ROUTES_REPOSITORY);
  const DAY = 86_400_000;
  const shiftDates = (o, ms, keys) => {
    for (const k of keys) if (o?.[k] instanceof Date) o[k] = new Date(o[k].getTime() - ms);
  };
  /** One finished run `daysAgo`; `lateMin` moves his garage check-in after the announced time. */
  async function pastRun(driverId, { daysAgo, garageId, corridorId = 'aziziyah_baghdad', vehicle, groups, walkUps, walkUpAs = 'rijal', lateMin = 0 }) {
    const g = deps.garage(garageId);
    const dep = await deps.announce(driverId, { garageId, corridorId, departAt: new Date(Date.now() - 4 * MIN), latestDepartureAt: new Date(Date.now() + 26 * MIN), vehicle, familyOnly: false });
    const booked = [];
    for (const grp of groups) {
      const held = await deps.hold(grp.rider ?? rider(), { departureId: dep.id, selection: { kind: 'seats', seatIds: grp.seats }, travellingAs: grp.as, pickup: { kind: 'garage' }, largeBags: false });
      booked.push({ grp, b: await deps.book(held.riderId, held.id, 'cash') });
    }
    for (const seatId of walkUps) await deps.markWalkUp(driverId, dep.id, { seatId, travellingAs: walkUpAs });
    await deps.selfie(driverId, dep.id, 'demo/selfie.jpg');
    await deps.driverPosition(driverId, dep.id, { lat: g.lat, lng: g.lng });
    for (const { b } of booked) await deps.checkIn(driverId, dep.id, b.pin);
    await deps.depart(driverId, dep.id);
    await deps.arrive(driverId, dep.id);
    for (const { grp, b } of booked) if (grp.stars) await deps.rate(b.riderId, b.id, { stars: grp.stars, tags: grp.tags ?? [], ...(grp.text ? { comment: grp.text } : {}) });
    const ms = daysAgo * DAY;
    const d = routesRepo.departures?.get(dep.id);
    if (d) {
      shiftDates(d, ms, ['departAt', 'latestDepartureAt', 'announcedAt', 'boardingAt', 'departedAt', 'arrivedAt', 'closedAt', 'createdAt', 'selfieAt']);
      if (d.driverCheckIn) d.driverCheckIn = { ...d.driverCheckIn, at: new Date(d.departAt.getTime() + lateMin * MIN) };
      d.trail = [];
      d.lastPosition = null;
    }
    for (const { b } of booked) {
      const r = routesRepo.bookings?.get(b.id);
      if (!r) continue;
      shiftDates(r, ms, ['createdAt', 'bookedAt', 'checkedInAt', 'completedAt', 'heldUntil']);
      if (r.rating) r.rating = { ...r.rating, at: new Date(r.rating.at.getTime() - ms) };
      if (r.review) r.review = { ...r.review, at: new Date(r.review.at.getTime() - ms) };
    }
    return dep;
  }
  const GOOD = [['on_time', 'calm_driving'], ['clean_car', 'respectful'], ['on_time', 'respectful', 'clean_car'], ['calm_driving'], ['on_time']];
  const ALI_LINES = [
    'سايق محترم وسياقته هادئة، وصلنا قبل الوقت',
    'السيارة نظيفة ومبردة، والله ما حسينا بالطريق',
    'ينتظر الراكب وما يستعجل، الله يحفظه',
    'شغّل القرآن طول الطريق وكان هادئ',
    'ساعدني بالجناط ونزلني يم الكراج بالضبط',
    'أفضل سايق للنهضة، كل مرة أحجز وياه',
    'بس تأخر شوية بالسيطرة، مو ذنبه',
    'سيارة جديدة ومريحة',
  ];
  // علي حسن (the النترا on the board): 24 runs, two of three riders rate each, 8 lines → «سايق مميز».
  for (let i = 0; i < 24; i += 1) {
    const daysAgo = 3 + i * 6;
    const stars = i === 6 || i % 5 === 2 ? 4 : 5;
    await pastRun(D.drv_7K2Q, {
      daysAgo,
      garageId: 'mp_garage_nahdha',
      vehicle: saloon('12345 بغداد', 'النترا', 'بيضاء'),
      lateMin: i === 6 ? 14 : 0,
      groups: [
        { seats: ['back_left'], as: 'rijal', stars, tags: GOOD[i % GOOD.length], ...(i % 3 === 0 && ALI_LINES[i / 3] ? { text: ALI_LINES[i / 3] } : {}) },
        { seats: ['back_right'], as: 'rijal', stars: 5, tags: GOOD[(i + 2) % GOOD.length] },
        { seats: ['front'], as: 'rijal' },
      ],
      walkUps: ['back_middle'],
    });
  }
  // كرار عادل (the جمسي): families and women in the middle and back rows → «العوائل ترتاحله».
  for (let i = 0; i < 6; i += 1) {
    await pastRun(D.drv_4M9T, {
      daysAgo: 5 + i * 9,
      garageId: 'mp_garage_nahdha',
      vehicle: { kind: 'van', layout: 7, plate: '45678 بغداد', modelKey: 'gmc', color: 'رصاصي' },
      groups: [
        { seats: ['middle_left', 'middle_middle', 'middle_right'], as: 'aila', stars: 5, tags: ['respectful', 'calm_driving'], ...(i === 0 ? { text: 'كنا عائلة ويا أطفال، صبر علينا ووقف وين ما ردنا' } : {}) },
        { seats: ['rear_left', 'rear_middle', 'rear_right'], as: 'nisa', stars: i === 3 ? 4 : 5, tags: ['clean_car', 'respectful'], ...(i === 2 ? { text: 'محترم كلش، نرتاح نسافر وياه' } : {}) },
      ],
      walkUps: ['front'],
    });
  }
  // مرتضى سالم (the النترا from البوابة 1): a few runs, a mixed record, no badge yet.
  for (let i = 0; i < 4; i += 1) {
    await pastRun(D.drv_5R1D, {
      daysAgo: 4 + i * 11,
      garageId: 'mp_garage_bab1',
      vehicle: saloon('51234 واسط', 'النترا', 'بيضاء'),
      lateMin: i === 1 ? 12 : 0,
      groups: [
        { seats: ['back_left'], as: 'rijal', stars: i === 1 ? 3 : i === 0 ? 4 : 5, tags: i === 1 ? ['late'] : ['on_time', 'clean_car'], ...(i === 0 ? { text: 'زين، بس الأغاني صوتها عالي' } : {}) },
        { seats: ['back_right'], as: 'rijal', stars: 4, tags: ['respectful'] },
      ],
      walkUps: ['front', 'back_middle'],
    });
  }
  // مصطفى جاسم (the سوناتا): one run, two ratings → «جديد» until a third.
  await pastRun(D.drv_2X8P, {
    daysAgo: 2,
    garageId: 'mp_garage_nahdha',
    vehicle: saloon('77821 بغداد', 'سوناتا', 'فضية'),
    groups: [
      { seats: ['back_left'], as: 'rijal', stars: 5, tags: ['on_time'] },
      { seats: ['back_right'], as: 'rijal', stars: 5, tags: ['calm_driving'] },
    ],
    walkUps: ['front', 'back_middle'],
  });

  // Baghdad side — كراج النهضة → العزيزية.
  const d1 = await announce(D.drv_7K2Q, { garageId: 'mp_garage_nahdha', inMin: 20, latestMin: 40, vehicle: { ...saloon('12345 بغداد', 'النترا', 'بيضاء'), noSmoking: true, ac: true } });
  await seat(d1, ['front'], 'rijal');
  await seat(d1, ['back_left'], 'rijal');
  await seat(d1, ['back_right'], 'rijal');
  const d2 = await announce(D.drv_4M9T, { garageId: 'mp_garage_nahdha', inMin: 50, latestMin: 60, vehicle: { kind: 'van', layout: 7, plate: '45678 بغداد', modelKey: 'gmc', color: 'رصاصي', bigBags: true } });
  await seat(d2, ['middle_left', 'middle_middle'], 'nisa');
  await seat(d2, ['rear_left'], 'rijal');
  await deps.markWalkUp(D.drv_4M9T, d2.id, { seatId: 'rear_right', travellingAs: 'rijal' });
  await deps.selfie(D.drv_4M9T, d2.id, 'demo/selfie.jpg');
  const d3 = await announce(D.drv_9B3H, { garageId: 'mp_garage_nahdha', inMin: 80, vehicle: { kind: 'suv', layout: 6, plate: '30211 بغداد', modelKey: 'tahoe', color: 'سوداء' }, familyOnly: true });
  await seat(d3, ['middle_left', 'middle_right'], 'aila');
  const d4 = await announce(D.drv_2X8P, { garageId: 'mp_garage_nahdha', inMin: 130, vehicle: saloon('77821 بغداد', 'سوناتا', 'فضية') });
  await seat(d4, ['front'], 'rijal');
  // The nearly-full car is past T−30: give it a live position ~1.3 km from the garage.
  const carFrom = { lat: 33.3262, lng: 44.4262 };
  const nahdha = { lat: 33.3344, lng: 44.4165 };
  await deps.driverPosition(D.drv_7K2Q, d1.id, carFrom);
  let step = 0;
  globalThis.setInterval(() => {
    // Creep toward the garage every 10 s (stops short of the 150 m geofence).
    const f = Math.min(++step, 100) / 120;
    void deps
      .driverPosition(D.drv_7K2Q, d1.id, { lat: carFrom.lat + (nahdha.lat - carFrom.lat) * f, lng: carFrom.lng + (nahdha.lng - carFrom.lng) * f })
      .catch(() => {});
  }, 10_000).unref();

  // Aziziyah side — the three gates → بغداد (السوق left empty on purpose).
  const a1 = await announce(D.drv_5R1D, { garageId: 'mp_garage_bab1', inMin: 45, vehicle: saloon('51234 واسط', 'النترا', 'بيضاء') });
  await seat(a1, ['back_left'], 'nisa');
  await seat(a1, ['back_middle'], 'nisa');
  await seat(a1, ['front'], 'rijal');
  const a2 = await announce(D.drv_8T6W, { garageId: 'mp_garage_bab2', inMin: 95, vehicle: { kind: 'van', layout: 7, plate: '62210 واسط', modelKey: 'starex', color: 'بيضاء' } });
  await seat(a2, ['rear_left'], 'rijal');

  // Kut corridor, both ways.
  const k1 = await announce(D.drv_3C5N, { garageId: 'mp_garage_bab1', corridorId: 'aziziyah_kut', inMin: 40, vehicle: saloon('48810 واسط', 'أفانتي', 'سماوي') });
  await seat(k1, ['front'], 'rijal');
  await seat(k1, ['back_left', 'back_middle'], 'aila');
  const k2 = await announce(D.drv_6J2L, { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', inMin: 100, vehicle: saloon('39921 واسط', 'إلنترا', 'حمراء') });
  await seat(k2, ['back_right'], 'nisa');

  // Tomorrow (the board's day strip, s2): Baghdad → Aziziyah at 7:00 and 16:30, Aziziyah → Baghdad at
  // 6:30, Baghdad time. Minutes from now to a Baghdad wall-clock time tomorrow:
  const tomorrowAt = (h, m) => {
    const baghdad = new Date(Date.now() + 3 * 60 * MIN);
    const midnight = Date.UTC(baghdad.getUTCFullYear(), baghdad.getUTCMonth(), baghdad.getUTCDate()) - 3 * 60 * MIN;
    return Math.round((midnight + (24 + h) * 60 * MIN + m * MIN - Date.now()) / MIN);
  };
  const t1 = await announce(D.drv_2X8P, { garageId: 'mp_garage_nahdha', inMin: tomorrowAt(7, 0), vehicle: { ...saloon('77821 بغداد', 'سوناتا', 'فضية'), ac: true } });
  await seat(t1, ['front'], 'rijal');
  await announce(D.drv_9B3H, { garageId: 'mp_garage_nahdha', inMin: tomorrowAt(16, 30), vehicle: { kind: 'suv', layout: 6, plate: '30211 بغداد', modelKey: 'tahoe', color: 'سوداء', ac: true } });
  await announce(D.drv_8T6W, { garageId: 'mp_garage_bab2', inMin: tomorrowAt(6, 30), vehicle: { kind: 'van', layout: 7, plate: '62210 واسط', modelKey: 'starex', color: 'بيضاء' } });

  // Demand: 7 people for the coming hour (the "waiting with you" count) and 9 in a later 2-hour
  // window (the board banner), on the way back from Baghdad. None contains an announced time.
  const now = Date.now();
  const soon = { start: new Date(now), end: new Date(now + 60 * MIN) };
  const later = (() => {
    const local = new Date(now + 180 * MIN); // Baghdad wall time
    const h = local.getUTCHours();
    const startH = h + 3 <= 16 ? 16 : h + 3; // "بين 4 و 6" when the afternoon is still ahead
    const dayStart = now - ((local.getUTCHours() * 60 + local.getUTCMinutes()) * MIN + local.getUTCSeconds() * 1000 + local.getUTCMilliseconds());
    const start = new Date(dayStart + startH * 60 * MIN);
    return { start, end: new Date(start.getTime() + 120 * MIN) };
  })();
  const soonPosts = [];
  for (let i = 0; i < 7; i++) {
    const p = await demand.post(rider(), {
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
      windowStart: soon.start,
      windowEnd: soon.end,
      seats: 1,
      travellingAs: i % 3 === 0 ? 'nisa' : 'rijal',
      pickup: { kind: 'garage' },
    });
    soonPosts.push(p);
  }
  for (let i = 0; i < 9; i++) {
    await demand.post(rider(), {
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
      windowStart: later.start,
      windowEnd: later.end,
      seats: i % 4 === 0 ? 2 : 1,
      travellingAs: i % 2 ? 'rijal' : 'nisa',
      pickup: { kind: 'garage', garageId: 'mp_garage_nahdha' },
    });
  }

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const personOf = (req) => new URL(req.url ?? '/', 'http://x').searchParams.get('personId');

  app.use('/demo/rajaa/claim', async (req, res) => {
    try {
      const personId = personOf(req);
      const open = (await demand.mine(personId ?? '')).filter((p) => p.state === 'open');
      const post = open[0];
      if (req.method !== 'POST' || !post) return json(res, 400, { error: 'POST with a personId that has an open demand post' });
      // The other riders in that window found cars of their own (so the seat goes to this person).
      for (const p of soonPosts) if (p.state === 'open') await demand.cancel(p.riderId, p.id).catch(() => {});
      const departAt = new Date(Math.min(post.windowEnd.getTime() - MIN, Math.max(post.windowStart.getTime(), Date.now()) + 45 * MIN));
      const dep = await deps.announce(D.drv_1Q7Z, {
        garageId: post.garageId ?? (post.direction === 'to_aziziyah' ? 'mp_garage_nahdha' : 'mp_garage_bab1'),
        corridorId: post.corridorId,
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 45 * MIN),
        vehicle: saloon('20417 بغداد', 'كامري', 'بيضاء'),
        familyOnly: false,
      });
      json(res, 200, { departureId: dep.id, departAt });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/onboard?personId=…[&corridorId=…][&garageId=…] — this person is in the car: a seat on a car leaving bab 1 (or that garage)
  // in 10 minutes, booked (cash) and checked in with the PIN. Their boarding pass then carries طوارئ.
  let onboardSeq = 0;
  app.use('/demo/rajaa/onboard', async (req, res) => {
    try {
      const personId = personOf(req);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/onboard?personId=…' });
      const departAt = new Date(Math.ceil((Date.now() + 10 * MIN) / MIN) * MIN);
      const params = new URL(req.url ?? '/', 'http://x').searchParams;
      const road = params.get('road') === '1';
      // `&corridorId=aziziyah_kut` / `&garageId=mp_garage_nahdha` (a car back to Aziziyah) for the other roads.
      const garageId = params.get('garageId') ?? (params.get('corridorId') === 'aziziyah_kut' ? 'mp_garage_bab2' : 'mp_garage_bab1');
      const corridorId = params.get('corridorId') ?? 'aziziyah_baghdad';
      // A fresh driver each call (a driver cannot announce two overlapping departures); on the road
      // (`road=1`) a named one, so the pass, the road map's car and the family page show his name.
      let driverId = `drv_S0S${(++onboardSeq).toString(36).toUpperCase()}`;
      if (road) {
        const phone = `07719${String(990000 + onboardSeq).padStart(6, '0')}`;
        await identity.requestOtp({ phone, purpose: 'login' });
        const { code: otp } = await identity.devLastOtp(phone);
        driverId = (await identity.verifyOtp({ phone, code: otp })).personId;
        await identity.grantRole({ personId: 'system:demo' }, { personId: driverId, kind: 'intercity_driver' });
        await identity.setName({ personId: driverId, sessionId: 'demo' }, 'مصطفى جاسم');
      }
      const dep = await deps.announce(driverId, {
        garageId,
        corridorId,
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 30 * MIN),
        vehicle: saloon('58120 واسط', 'كامري', 'بيضاء'),
        familyOnly: false,
      });
      // A car announced in Baghdad is filled at once by the demo's riders waiting there: let them go
      // (in-memory demo riders only), so this person's seat is free.
      for (const b of routesRepo.bookings?.values() ?? []) if (b.departureId === dep.id && b.origin === 'demand_claim') b.state = 'cancelled';
      let held = null;
      for (const seatId of ['back_right', 'back_left', 'back_middle', 'front']) {
        held = await deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: [seatId] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false }).catch((e) => (String(e).includes('took that seat') ? null : Promise.reject(e)));
        if (held) break;
      }
      if (!held) return json(res, 409, { error: 'no seat left on that car' });
      const booked = await deps.book(personId, held.id, 'cash');
      // `&road=1` (r1–r3): his mother and Zainab follow every trip; the car has just left, 12 % of
      // the way to Baghdad, so the pass shows the road line, the arrival and who is watching.
      if (road) {
        await app.get(IdentityService).updateProfile(
          { personId, sessionId: 'demo' },
          { trustedContacts: [{ name: 'أمي', phone: '07801112233', relation: 'mother' }, { name: 'زينب', phone: '07801114455', relation: 'sibling' }], safety: { autoShareRajaa: true } },
        );
      }
      await deps.checkIn(driverId, dep.id, booked.pin);
      if (road) {
        // Before its time only a full car leaves: the other seats are walk-ups.
        await deps.selfie(driverId, dep.id, 'demo/selfie.jpg');
        for (const seatId of ['front', 'back_left', 'back_middle', 'back_right']) await deps.markWalkUp(driverId, dep.id, { seatId, travellingAs: 'rijal' }).catch(() => undefined);
        await deps.depart(driverId, dep.id);
        const bab1 = { lat: 32.91575, lng: 45.0405 };
        const nahdha = { lat: 33.3344, lng: 44.4165 };
        await deps.driverPosition(driverId, dep.id, { lat: bab1.lat + (nahdha.lat - bab1.lat) * 0.12, lng: bab1.lng + (nahdha.lng - bab1.lng) * 0.12 });
      }
      json(res, 200, { departureId: dep.id, bookingId: booked.id });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/road?bookingId=…&km=52[&ageMin=5] — N13 «طريق بغداد»: that booking's car (already
  // departed, e.g. /demo/rajaa/onboard?road=1) is put `km` along the real road from its garage, with a
  // fix there (`ageMin` minutes old, for the «آخر تحديث» state), and its departure time moved back so the
  // corridor's minutes reach that far (the times on the road read like a car keeping its pace).
  app.use('/demo/rajaa/road', async (req, res) => {
    try {
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const bookingId = q.get('bookingId');
      const km = Number(q.get('km') ?? '0');
      const ageMin = Number(q.get('ageMin') ?? '0');
      if (req.method !== 'POST' || !bookingId || !Number.isFinite(km)) return json(res, 400, { error: 'POST /demo/rajaa/road?bookingId=…&km=…[&ageMin=…]' });
      const booking = routesRepo.bookings?.get(bookingId);
      const d = booking ? routesRepo.departures?.get(booking.departureId) : null;
      if (!d || d.state !== 'departed') return json(res, 409, { error: 'that booking\'s car has not left (try /demo/rajaa/onboard?road=1 first)' });
      const { INTERCITY_NETWORK } = await load('modules/routes/index.js');
      const { intercityRoad, roadGeoJSON } = await import('@driver/map/pieces/road');
      const corridor = INTERCITY_NETWORK.corridors.find((c) => c.id === d.corridorId);
      const keyOf = { mp_garage_bab1: 'bab1', mp_garage_bab2: 'bab2', mp_garage_souq: 'souq' };
      const direction = d.garageId in keyOf ? 'from_aziziyah' : 'to_aziziyah';
      const road = intercityRoad(keyOf[d.garageId] ?? (corridor.cityId === 'kut' ? 'bab2' : 'bab1'), corridor.cityId, direction);
      const m = Math.max(0, Math.min(road.totalM - 50, km * 1000));
      const car = roadGeoJSON(road, { m }).features.find((f) => f.properties.part === 'car')?.geometry.coordinates ?? road.path[0];
      await deps.driverPosition(d.driverId, d.id, { lat: car[1], lng: car[0] });
      // The write stored a new record: move its times on that one.
      const rec = routesRepo.departures.get(d.id);
      const now = Date.now();
      rec.lastPosition = { ...rec.lastPosition, at: new Date(now - ageMin * MIN) };
      rec.departedAt = new Date(now - ageMin * MIN - (m / road.totalM) * corridor.travelMin * MIN);
      json(res, 200, { bookingId, departureId: d.id, km: Math.round(m / 100) / 10, totalKm: Math.round(road.totalM / 100) / 10, at: { lat: car[1], lng: car[0] } });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/outbound?personId=… — a wallet-paid seat on a car leaving bab 1 for Baghdad in
  // 45 minutes, from the garage: the pass then shows when to leave home (t4) and the three-stage late
  // bar (t6). Tops the wallet up by the fare first, like a rider who keeps credit.
  let outboundSeq = 0;
  app.use('/demo/rajaa/outbound', async (req, res) => {
    try {
      const personId = personOf(req);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/outbound?personId=…' });
      const departAt = new Date(Math.ceil((Date.now() + 45 * MIN) / MIN) * MIN);
      const driverId = `drv_OUT${(++outboundSeq).toString(36).toUpperCase()}`;
      const dep = await deps.announce(driverId, {
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 30 * MIN),
        vehicle: { ...saloon('63410 واسط', 'كورولا', 'بيضاء'), ac: true },
        familyOnly: false,
      });
      await ledger.record({ type: 'adjustment', amount: 10_000, fromAccount: 'bank', toAccount: `customer:${personId}`, occurredAt: new Date(), memo: 'demo top-up' });
      const held = await deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_right'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
      const booked = await deps.book(personId, held.id, 'wallet');
      json(res, 200, { departureId: dep.id, bookingId: booked.id });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/garage[?garageId=mp_garage_bab1] — map idea N12 «شوف الكراج»: three more cars to
  // Baghdad standing in that garage (in 20, 70 and 110 minutes), some seats already taken, so the lot
  // shows a full-ish car, a half one and an empty one.
  let garageSeq = 0;
  app.use('/demo/rajaa/garage', async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/rajaa/garage[?garageId=…]' });
      const garageId = new URL(req.url ?? '/', 'http://x').searchParams.get('garageId') || 'mp_garage_bab1';
      const cars = [
        { inMin: 20, vehicle: saloon('70412 واسط', 'كامري', 'بيضاء'), taken: [['back_left', 'back_middle'], ['front']] },
        { inMin: 70, vehicle: { kind: 'van', layout: 7, plate: '81123 واسط', modelKey: 'starex', color: 'فضية' }, taken: [['middle_left', 'middle_middle']] },
        { inMin: 110, vehicle: saloon('66508 واسط', 'كورولا', 'رصاصي'), taken: [] },
      ];
      const ids = [];
      for (const c of cars) {
        const driverId = `drv_GAR${(++garageSeq).toString(36).toUpperCase()}`;
        const departAt = new Date(Math.ceil((Date.now() + c.inMin * MIN) / (5 * MIN)) * 5 * MIN);
        const dep = await deps.announce(driverId, { garageId, corridorId: 'aziziyah_baghdad', departAt, latestDepartureAt: new Date(departAt.getTime() + 45 * MIN), vehicle: c.vehicle, familyOnly: false });
        for (const seatIds of c.taken) {
          const held = await deps.hold(`demo-garage-rider-${garageSeq}-${seatIds[0]}`, { departureId: dep.id, selection: { kind: 'seats', seatIds }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
          await deps.book(held.riderId, held.id, 'cash');
        }
        ids.push(dep.id);
      }
      json(res, 200, { departureIds: ids });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/return?personId=… — step 5 «رايح وراجع» (demo switch on): a cash seat on a car to
  // Baghdad in 3 h and two cars back from النهضة later today, so the pass offers the way back for 10 %.
  let returnSeq = 0;
  app.use('/demo/rajaa/return', async (req, res) => {
    try {
      const personId = personOf(req);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/return?personId=…' });
      deps.money = { ...deps.money, intercityReturnBundle: { enabled: true, percent: 10, fundedBy: 'platform' } };
      const n = (++returnSeq).toString(36).toUpperCase();
      const at = (min) => new Date(Math.ceil((Date.now() + min * MIN) / (5 * MIN)) * 5 * MIN);
      const out = await deps.announce(`drv_RTO${n}`, {
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: at(180),
        latestDepartureAt: at(210),
        vehicle: { ...saloon('63411 واسط', 'النترا', 'رصاصي'), ac: true },
        familyOnly: false,
      });
      const back = [];
      for (const [i, min] of [420, 480].entries()) {
        const dep = await deps.announce(`drv_RTB${n}${i}`, {
          garageId: 'mp_garage_nahdha',
          corridorId: 'aziziyah_baghdad',
          departAt: at(min),
          latestDepartureAt: at(min + 30),
          vehicle: { ...saloon(i === 0 ? '52817 بغداد' : '47205 واسط', i === 0 ? 'كورولا' : 'سوناتا', 'بيضاء'), ac: true },
          familyOnly: false,
        });
        back.push(dep.id);
      }
      const held = await deps.hold(personId, { departureId: out.id, selection: { kind: 'seats', seatIds: ['back_right'] }, travellingAs: 'aila', pickup: { kind: 'garage' }, largeBags: false, lapChildren: 0 });
      const booked = await deps.book(personId, held.id, 'cash');
      json(res, 200, { departureId: out.id, bookingId: booked.id, backDepartureIds: back });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/arrived?personId=…[&told=1] — a whole trip that just ended (joy r2): a seat on a
  // car from Kut to Aziziyah, the other seats walk-ups, checked in, departed and arrived. The pass
  // then shows «وصلت بالسلامة». `told=1` first gives the person a trusted contact (أمي) with
  // «بلّغهم من أوصل» on, so the card says who was told and the WhatsApp ping goes out.
  let arrivedSeq = 0;
  app.use('/demo/rajaa/arrived', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/arrived?personId=…[&told=1]' });
      if (url.searchParams.get('told') === '1') {
        await app.get(IdentityService).updateProfile({ personId, sessionId: 'demo' }, { trustedContacts: [{ name: 'أمي', phone: '07801112233', relation: 'mother' }], safety: { notifyOnArrival: true } });
      }
      const departAt = new Date(Math.ceil((Date.now() + 10 * MIN) / MIN) * MIN);
      const driverId = `drv_ARR${(++arrivedSeq).toString(36).toUpperCase()}`;
      // From the Kut garage home to Aziziyah: no demand posts there to claim the seats first.
      const dep = await deps.announce(driverId, {
        garageId: 'mp_garage_kut',
        corridorId: 'aziziyah_kut',
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 30 * MIN),
        vehicle: saloon('41187 واسط', 'كامري', 'بيضاء'),
        familyOnly: false,
      });
      const held = await deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_right'] }, travellingAs: 'nisa', pickup: { kind: 'garage' }, largeBags: false });
      const booked = await deps.book(personId, held.id, 'cash');
      await deps.selfie(driverId, dep.id, 'demo/selfie.jpg');
      for (const seatId of ['front', 'back_left', 'back_middle']) await deps.markWalkUp(driverId, dep.id, { seatId, travellingAs: seatId === 'front' ? 'rijal' : 'nisa' });
      await deps.checkIn(driverId, dep.id, booked.pin);
      await deps.depart(driverId, dep.id);
      await deps.arrive(driverId, dep.id);
      json(res, 200, { departureId: dep.id, bookingId: booked.id });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/rode?personId=… — «سافرت وياه قبل» (x17): two of علي حسن's past runs become this
  // person's (the front seat nobody rated), so his tile, seat sheet and profile say they rode with him.
  app.use('/demo/rajaa/rode', async (req, res) => {
    try {
      const personId = personOf(req);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/rode?personId=…' });
      const aliRuns = new Set([...routesRepo.departures.values()].filter((d) => d.driverId === D.drv_7K2Q && ['arrived', 'closed'].includes(d.state)).map((d) => d.id));
      const seats = [...routesRepo.bookings.values()].filter((b) => aliRuns.has(b.departureId) && b.state === 'completed' && !b.rating && b.seatIds.includes('front'));
      for (const b of seats.slice(0, 2)) b.riderId = personId;
      json(res, 200, { rides: Math.min(2, seats.length) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // y5: private trips the offering drivers already completed (post → offer → pick → done), once.
  // They go to Najaf (the chip) there and back with a 4-hour wait, so that trip has a usual range (p1).
  let privateSeeded = false;
  async function seedPrivateTrips() {
    if (privateSeeded) return;
    privateSeeded = true;
    for (const [driverId, n, price] of [[D.drv_4M9T, 11, 60_000], [D.drv_7K2Q, 6, 55_000], [D.drv_5R1D, 2, 45_000]]) {
      for (let i = 0; i < n; i += 1) {
        const who = rider();
        await ledger.record({ type: 'adjustment', amount: 20_000, fromAccount: 'bank', toAccount: `customer:${who}`, occurredAt: new Date(), memo: 'demo top-up' });
        const r = await requests.post(who, { from: { label: 'العزيزية' }, to: { label: 'النجف', placeId: 'najaf' }, when: at(1), seats: 2, privateCar: true, travellingAs: 'aila', details: { trip: 'wait_return', waitHours: 4, returnAt: null, bigBags: 0, carKind: null, ac: false } });
        const o = (await requests.offer(driverId, r.id, price, { includedHours: 4, extraHourIqd: 5_000 })).offers.at(-1);
        await requests.pick(who, r.id, o.id);
        await requests.complete(driverId, r.id);
      }
    }
  }

  // p1: the finished trips behind «عادةً بين … و …», before the rider opens the request form.
  app.use('/demo/rajaa/history', async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
      await seedPrivateTrips();
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/rajaa/offers', async (req, res) => {
    try {
      const personId = personOf(req);
      const open = (await requests.mine(personId ?? '')).filter((r) => r.state === 'open');
      if (req.method !== 'POST' || open.length === 0) return json(res, 400, { error: 'POST with a personId that has an open request' });
      await seedPrivateTrips();
      for (const r of open) {
        // y4: seven drivers opened it, four offered (y5, y6: the Elantra with AC, the cheaper Avante
        // without, the GMC with the best record, and one more).
        for (const d of [D.drv_1Q7Z, D.drv_6J2L, D.drv_9B3H]) await requests.seen(d, r.id);
        // w1: on a «يستناك وترجع» trip each offer says the hours included and the extra-hour price
        // (one includes fewer hours than asked, one waits for free); p3: one is well above the usual.
        const asked = r.details.waitHours ?? 3;
        const wait = (hours, extra) => (r.details.trip === 'wait_return' ? { includedHours: hours, extraHourIqd: extra } : undefined);
        await requests.offer(D.drv_7K2Q, r.id, 55_000, wait(asked, 5_000));
        await requests.offer(D.drv_3C5N, r.id, 42_000, wait(Math.max(1, asked - 2), 5_000));
        await requests.offer(D.drv_4M9T, r.id, 60_000, wait(asked, 0));
        await requests.offer(D.drv_5R1D, r.id, 48_000, wait(asked, 4_000));
        await requests.offer(D.drv_9B3H, r.id, 80_000, wait(asked + 1, 5_000));
      }
      json(res, 200, { requests: open.map((r) => r.id) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/waiting?personId=…&min=…[&charged=1] — w2: the driver of that person's picked
  // «يستناك وترجع» request dropped them `min` minutes ago and is waiting; `charged=1` shows the extra
  // hours as they will look once Ali switches the charge on (the demo only; the launch rule stays off).
  app.use('/demo/rajaa/waiting', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const min = Number(url.searchParams.get('min') ?? 60);
      const live = personId ? (await requests.mine(personId)).filter((r) => r.state === 'matched' || r.state === 'driver_arrived') : [];
      if (req.method !== 'POST' || live.length === 0) return json(res, 400, { error: 'POST with a personId that has a picked request' });
      const { ROUTES_REPOSITORY } = await load('modules/routes/index.js');
      const repo = app.get(ROUTES_REPOSITORY);
      requests.moneyRules = { ...requests.moneyRules, requestWaitExtra: { enabled: url.searchParams.get('charged') === '1', freeMin: 15 } };
      for (const r of live) {
        const driverId = r.offers.find((o) => o.id === r.pickedOfferId)?.driverId;
        if (!driverId) continue;
        if (r.state === 'matched') await requests.arrived(driverId, r.id, { lat: 32.9105, lng: 45.0611 });
        const now = await requests.get(r.id);
        if (!now.waitStartedAt) await requests.waitStart(driverId, r.id);
        const back = await requests.get(r.id);
        back.waitStartedAt = new Date(Date.now() - min * 60_000);
        back.waitEndedAt = null;
        await repo.saveRequest(back);
      }
      json(res, 200, { requests: live.map((r) => r.id) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/cash?personId=…[&answer=accept|decline|ask|none][&owe=5000] — step 4b a6 «احجز وادفع كاش»:
  // switches the rule on for this demo only (the launch rule stays off), asks the 42,000 driver on each of
  // the person's open requests and answers as given (`ask` leaves it waiting, `none` only switches it
  // on and names the offer); `owe` puts a past
  // no-show on his wallet so the «عليك» line shows.
  app.use('/demo/rajaa/cash', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const answer = url.searchParams.get('answer') ?? 'accept';
      const open = personId ? (await requests.mine(personId)).filter((r) => r.state === 'open') : [];
      if (req.method !== 'POST' || open.length === 0) return json(res, 400, { error: 'POST with a personId that has an open request with offers' });
      requests.moneyRules = { ...requests.moneyRules, requestCashReservation: { enabled: true } };
      const asked = [];
      for (const r of open) {
        const o = r.offers.find((x) => x.state === 'open' && x.driverId === D.drv_3C5N) ?? r.offers.find((x) => x.state === 'open');
        if (!o) continue;
        if (answer === 'none') {
          asked.push(o.id);
          continue;
        }
        if (!o.cash) await requests.askCash(personId, r.id, o.id);
        if (answer !== 'ask' && (o.cash ?? 'asked') === 'asked') await requests.answerCash(o.driverId, r.id, o.id, answer === 'accept');
        asked.push(o.id);
      }
      const owe = Number(url.searchParams.get('owe') ?? 0);
      if (owe > 0) {
        const { LedgerService } = await load('modules/ledger/index.js');
        const { postCancellation } = await load('modules/ledger/postings.js');
        await app.get(LedgerService).recordAll(postCancellation({ from: 'placed', to: 'customer_cancelled', cancelledState: 'customer_cancelled', orderId: `demo_owe_${Date.now()}`, occurredAt: new Date(), customerId: personId, by: 'customer', reason: 'request_board_rider_no_show', free: false, feeIqd: owe, beneficiaries: [{ kind: 'driver', id: D.drv_7K2Q, amountIqd: owe }] }));
      }
      json(res, 200, { offers: asked });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/share?personId=…&as=booker|friend[&joined=1] — step 6 «تقاسم السيارة» (demo switch
  // on): a private car to Baghdad for 4 people in 10 h, علي حسن's 110,000 picked. `booker`: the person
  // booked it and opened the link, and كرار already paid his place. `friend`: أحمد booked it and shared
  // it, زيد took a place, and the person has the link (`joined=1`: he took a place too).
  let shareSeq = 0;
  const sharePeople = {};
  async function namedPerson(name) {
    if (sharePeople[name]) return sharePeople[name];
    const phone = `0771977${String(1000 + Object.keys(sharePeople).length).padStart(4, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code: otp } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code: otp })).personId;
    await identity.setName({ personId: id, sessionId: 'demo' }, name);
    sharePeople[name] = id;
    return id;
  }
  const topUp = (who, amount) => ledger.record({ type: 'adjustment', amount, fromAccount: 'bank', toAccount: `customer:${who}`, occurredAt: new Date(), memo: 'demo top-up' });
  app.use('/demo/rajaa/share', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const as = url.searchParams.get('as') ?? 'booker';
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/share?personId=…&as=booker|friend[&joined=1]' });
      requests.moneyRules = { ...requests.moneyRules, requestSharing: { enabled: true, closeBeforeMin: 120 } };
      // `postId`: كرار joins the link the person opened on that request himself.
      const postId = url.searchParams.get('postId');
      if (postId) {
        const code = (await requests.get(postId))?.share?.code;
        if (!code) return json(res, 400, { error: 'that request has no share link yet' });
        const friend = await namedPerson('كرار حسن');
        await topUp(friend, 30_000);
        await requests.joinShare(friend, code, 1);
        return json(res, 200, { postId, code });
      }
      shareSeq += 1;
      const booker = as === 'friend' ? await namedPerson('أحمد علي') : personId;
      await topUp(booker, 60_000);
      const when = new Date(Math.ceil((Date.now() + 600 * MIN) / (5 * MIN)) * 5 * MIN);
      const r = await requests.post(booker, { from: { label: 'العزيزية · البيت' }, to: { label: 'بغداد · مستشفى ابن النفيس' }, when, seats: 4, privateCar: true, travellingAs: 'aila', details: { trip: 'one_way', waitHours: null, returnAt: null, bigBags: 1, carKind: null, ac: true } });
      const o = (await requests.offer(D.drv_7K2Q, r.id, 110_000)).offers.at(-1);
      await requests.pick(booker, r.id, o.id);
      if (url.searchParams.get('open') === '0') return json(res, 200, { postId: r.id, code: null });
      const code = (await requests.openShare(booker, r.id, 1)).share.code;
      const friend = await namedPerson(as === 'friend' ? 'زيد كاظم' : 'كرار حسن');
      await topUp(friend, 30_000);
      await requests.joinShare(friend, code, 1);
      if (as === 'friend') {
        await topUp(personId, 60_000);
        if (url.searchParams.get('joined') === '1') await requests.joinShare(personId, code, 1);
      }
      // Way C: `arrived=1` brings the trip to now and علي حسن to the door (CAR_AT); `board=self` has the
      // other friend say «صعدت»; `board=driver` has the driver confirm the person (a friend) himself.
      const CAR_AT = { lat: 32.9105, lng: 45.0611 };
      if (url.searchParams.get('arrived') === '1') {
        const rec = await requests.get(r.id);
        await requests.repo.saveRequest({ ...rec, when: new Date(Math.ceil((Date.now() + 5 * MIN) / (5 * MIN)) * 5 * MIN) });
        await requests.arrived(D.drv_7K2Q, r.id, CAR_AT);
        const board = url.searchParams.get('board');
        if (board === 'self') await requests.boardShare(friend, code, CAR_AT);
        if (board === 'driver') {
          const m = (await requests.get(r.id)).share.members.find((x) => x.personId === personId && x.state === 'joined');
          if (m) await requests.boardShareFor(D.drv_7K2Q, r.id, m.id);
        }
      }
      json(res, 200, { postId: r.id, code, n: shareSeq, carAt: CAR_AT });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // POST /demo/rajaa/agreements?personId=…&departureId=… — step 4 agreed prices: the driver of that
  // car prices every ask the person made on it (a pin on the road 2,000 دينار, a door drop ببلاش),
  // asking a door drop for him first if he has none open.
  app.use('/demo/rajaa/agreements', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const departureId = url.searchParams.get('departureId');
      if (req.method !== 'POST' || !personId || !departureId) return json(res, 400, { error: 'POST /demo/rajaa/agreements?personId=…&departureId=…' });
      const { AgreementsService, INTERCITY_NETWORK } = await load('modules/routes/index.js');
      const agreements = app.get(AgreementsService);
      const dep = await deps.departure(departureId);
      const open = (a) => a.state === 'asked' || a.state === 'proposed' || a.state === 'accepted';
      if (!(await agreements.mine(personId, dep.id)).some((a) => a.kind === 'door_drop' && open(a))) {
        const far = INTERCITY_NETWORK.garages.find((g) => g.cityId === dep.toCityId && !g.draft) ?? INTERCITY_NETWORK.garages.find((g) => g.cityId === dep.toCityId);
        await agreements.ask(personId, { departureId: dep.id, kind: 'door_drop', lat: far.lat + 0.018, lng: far.lng + 0.006, note: 'البيت الثاني بعد الجامع' });
      }
      const priced = [];
      for (const a of await agreements.mine(personId, dep.id)) {
        if (a.state !== 'asked') continue;
        priced.push((await agreements.propose(dep.driverId, { agreementId: a.id, amountIqd: a.kind === 'pin_pickup' ? 2_000 : 0 })).id);
      }
      json(res, 200, { priced });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // Step 4c: the Baghdad/Kut chat. The rider asks the driver about a spot on the road (سيطرة المدائن) and
  // his door at the far end (each ask comes in as a card), the driver answers in words and prices both (2,000 and 3,000).
  app.use('/demo/rajaa/trip-chat', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const departureId = url.searchParams.get('departureId');
      if (req.method !== 'POST' || !personId || !departureId) return json(res, 400, { error: 'POST /demo/rajaa/trip-chat?personId=…&departureId=…' });
      const { AgreementsService, INTERCITY_NETWORK } = await load('modules/routes/index.js');
      const { TripChatService } = await load('modules/chat/index.js');
      const agreements = app.get(AgreementsService);
      const chat = app.get(TripChatService);
      const dep = await deps.departure(departureId);
      const far = INTERCITY_NETWORK.garages.find((g) => g.cityId === dep.toCityId && !g.draft) ?? INTERCITY_NETWORK.garages.find((g) => g.cityId === dep.toCityId);
      const pin = await agreements.ask(personId, { departureId: dep.id, kind: 'pin_pickup', lat: 33.1667, lng: 44.5517, note: 'سيطرة المدائن، صوب الكازية' });
      const door = await agreements.ask(personId, { departureId: dep.id, kind: 'door_drop', lat: far.lat + 0.018, lng: far.lng + 0.006, note: 'حي العسكري، قرب الجامع' });
      const driver = { personId: dep.driverId, sessionId: 'demo' };
      const ref = { subject: 'departure', id: dep.id, with: personId };
      await new Promise((r) => setTimeout(r, 400));
      await chat.send(driver, { ...ref, clientId: `demo-tc-${Date.now()}-1`, text: 'هلا بيك، إي أگدر. شوف الأسعار تحت' });
      await agreements.propose(dep.driverId, { agreementId: pin.id, amountIqd: 2_000 });
      await agreements.propose(dep.driverId, { agreementId: door.id, amountIqd: 3_000 });
      json(res, 200, { pin: pin.id, door: door.id });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/rajaa/topup', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const amount = Number(url.searchParams.get('amount') ?? 25_000);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/topup?personId=…&amount=…' });
      await ledger.record({ type: 'adjustment', amount, fromAccount: 'bank', toAccount: `customer:${personId}`, occurredAt: new Date(), memo: 'demo top-up' });
      json(res, 200, { personId, amount });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  return { departures: [d1, d2, d3, d4, a1, a2, k1, k2].map((d) => d.id) };
})();

// ───────────────────────── account demo (places, points, household) ─────────────────────────
//   POST /demo/account?personId=<id>
// Seeds the M3 account screens for that person: a gate photo on (and confirmation of) their home,
// a work place, a cash food order with change kept as credit, an agent top-up, 2,500 points (+ 40
// pending under their number), a household where Minar (25,000 limit) waits for approval of a
// 32,000 order and shares her family home, and two خطوط children (زهراء with a photo, محمد without)
// for أطفال الخطوط (/household/children).
{
  const { deflateSync } = await import('node:zlib');
  const { Buffer } = await import('node:buffer');
  const { IdentityService } = await load('modules/identity/index.js');
  const { SavedPlacesService, BLOB_STORE } = await load('modules/places/index.js');
  const { LedgerService, Accounts } = await load('modules/ledger/index.js');
  const identity = app.get(IdentityService);
  const places = app.get(SavedPlacesService);
  const blobs = app.get(BLOB_STORE);
  const ledger = app.get(LedgerService);

  /** A 192×192 PNG of a green door in a cream wall: the demo gate photo. */
  const doorPng = () => {
    const W = 192;
    const H = 192;
    const px = (x, y) => {
      if (x >= 62 && x < 130 && y >= 40 && y < 176) {
        if (x >= 66 && x < 126 && y >= 44) return x === 96 || (y > 104 && y < 108) ? [22, 84, 54] : x > 112 && x < 118 && y > 108 && y < 116 ? [214, 170, 60] : [34, 120, 76];
        return [120, 92, 62];
      }
      if (y >= 176) return [176, 160, 136];
      const brick = (Math.floor(y / 12) % 2 === 0 ? x : x + 16) % 32 < 1 || y % 12 < 1;
      return brick ? [214, 196, 168] : [236, 222, 196];
    };
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) {
      raw[y * (W * 3 + 1)] = 0;
      for (let x = 0; x < W; x++) raw.set(px(x, y), y * (W * 3 + 1) + 1 + x * 3);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(td));
      return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };

  const photoFor = async (ownerId) => {
    const bytes = doorPng();
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/png', sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
    return ticket.uploadId;
  };

  const group = (id, kind, at, lines) => ({ id, kind, occurredAt: at, refs: {}, lines, controls: [] });

  app.use('/demo/account', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) {
        res.statusCode = 400;
        res.end('POST /demo/account?personId=…');
        return;
      }
      const now = Date.now();
      const ago = (h) => new Date(now - h * 3_600_000);

      // Places: photo + confirmation on the home from setup (or a new one), a work place.
      const mine = await places.mine(personId);
      let home = mine.find((p) => p.label === 'home' && p.access === 'owner');
      home ??= await places.save(personId, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: { lat: 32.9097, lng: 45.0633 }, photoIds: [], shareWithHousehold: false });
      await places.update(personId, { placeId: home.id, note: 'باب أخضر، يم جامع الرسول', photoIds: [await photoFor(personId)], shareWithHousehold: true });
      await places.confirm(personId, { placeId: home.id, pin: { lat: 32.9097, lng: 45.0633 }, accuracyM: 8 });
      if (!mine.some((p) => p.label === 'work')) {
        await places.save(personId, { cityId: 'aziziyah', label: 'work', name: 'مستشفى العزيزية', pin: { lat: 32.8962, lng: 45.0671 }, note: 'الباب الخلفي، قسم المختبر', photoIds: [], shareWithHousehold: false });
      }

      // Wallet: a top-up, a cash food order with 500 change kept, points earned, pending points.
      const hash = await identity.phoneHashOf(personId);
      const customer = Accounts.customer(personId);
      await ledger.recordAll([
        group(`demo:topup:${personId}`, 'money', ago(50), [{ type: 'credit_issued', amount: 25_000, fromAccount: Accounts.bank, toAccount: customer, memo: 'topup:agent' }]),
        group(`demo:order:${personId}`, 'money', ago(3), [
          { type: 'merchant_payable', amount: 14_000, fromAccount: customer, toAccount: Accounts.merchantCash(khalid.orgId), memo: 'items' },
          { type: 'service_fee', amount: 500, fromAccount: customer, toAccount: Accounts.platform },
          { type: 'delivery_fee', amount: 1_000, fromAccount: customer, toAccount: Accounts.driver('demo-courier') },
          { type: 'cash_collected', amount: 15_500, fromAccount: Accounts.cash('demo-courier'), toAccount: customer },
          { type: 'cash_rounding_credit', amount: 500, fromAccount: Accounts.cash('demo-courier'), toAccount: customer, memo: 'change_as_credit' },
        ]),
        group(`demo:points:${personId}`, 'points', ago(26), [{ type: 'points_earned', amount: 2_485, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
        group(`demo:points2:${personId}`, 'points', ago(3), [{ type: 'points_earned', amount: 15, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
        ...(hash ? [group(`demo:pending:${personId}`, 'points', ago(72), [{ type: 'points_pending', amount: 40, fromAccount: Accounts.pointsPool, toAccount: Accounts.pointsPending(hash) }])] : []),
      ]);

      // Household: payer = this person; Minar orders with a 25,000 limit and asks for 32,000.
      let household = (await orgs.householdsOf(personId))[0];
      household ??= await orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: personId });
      const minar = await identity.ensurePersonByPhone('07801234567', personId, 'demo');
      await identity.updateProfile({ personId: minar, sessionId: 'demo' }, { name: 'منار' });
      await orgs.addMember(household.id, minar, { role: 'orderer', spendingLimitIqd: 25_000, actorId: personId });
      const kid = await identity.ensurePersonByPhone('07709876543', personId, 'demo');
      await identity.updateProfile({ personId: kid, sessionId: 'demo' }, { name: 'حسين' });
      await orgs.addMember(household.id, kid, { role: 'orderer', spendingLimitIqd: 10_000, actorId: personId });
      // The household wallet first, so Minar's order can be paid from it.
      await ledger.recordAll(group(`demo:hh:${household.id}`, 'money', ago(30), [{ type: 'credit_issued', amount: 60_000, fromAccount: Accounts.bank, toAccount: Accounts.household(household.id), memo: 'topup:agent' }]));
      // A real order of Minar's at مطعم خالد on the household wallet, over her 25,000 limit: the server
      // holds it for the payer (joy w4), and the approval names the kitchen, the dishes and where (w5).
      const pending = (await orgs.pendingApprovals(household.id)).some((a) => a.requestedBy === minar);
      if (!pending) {
        try {
          await orders.place(minar, {
            cityId: 'aziziyah',
            type: 'food',
            merchantOrgId: khalid.orgId,
            lines: [['khalid_mix', 1], ['liver_plate', 2], ['pepsi', 2]].map(([k, qty]) => ({ catalogItemId: khalid.itemIds.get(k), qty })),
            paymentMethod: 'wallet',
            householdOrgId: household.id,
            familyTable: true,
            dropoff: { zoneKey: 'street_30', pin: { lat: 32.9097, lng: 45.0633 } },
          });
        } catch {
          // The kitchen may be closed at this hour: a request with the amount alone stands in.
          await orgs.requestPayerApproval({ orgId: household.id, orderId: `demo-order-${now}`, requestedBy: minar, amountIqd: 32_000, reason: 'order_limit' });
        }
      }
      if (!(await places.mine(minar)).some((p) => p.access === 'owner')) {
        await places.save(minar, { cityId: 'aziziyah', label: 'custom', name: 'بيت أهل منار', pin: { lat: 32.887, lng: 45.0765 }, note: 'البيت الثالث بعد الفرن', photoIds: [], shareWithHousehold: true });
      }
      // خطوط children (Ali, 2026-10-06): two on school runs; زهراء already has a photo (أطفال الخطوط).
      if ((await identity.myChildren({ personId })).length === 0) {
        const { KhatService } = await load('modules/khat/index.js');
        const zahraa = (await identity.registerChild({ personId }, { name: 'زهراء علي' })).childRef;
        await identity.registerChild({ personId }, { name: 'محمد علي' });
        const bytes = avatarPng('زهراء علي', { child: true });
        const ticket = await blobs.createUpload({ ownerId: personId, contentType: 'image/png', sizeBytes: bytes.length });
        const u = new URL(ticket.uploadUrl, 'http://x');
        await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
        await app.get(KhatService).setChildPhoto({ personId, sessionId: 'demo' }, { childRef: zahraa, uploadId: ticket.uploadId });
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ householdId: household.id, homeId: home.id }));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });

  // ───────────────────────── «بيتنا» and «شهرك» (joy w4, w6) ─────────────────────────
  //
  //   POST /demo/family?personId=<id>   (after /demo/account)  → { householdId, held }
  //
  // Budgets: منار 25,000 an order and 100,000 a month, حسين 10,000 and 20,000. This month on the household
  // wallet: two delivered orders of منار's and two of حسين's, then a third of حسين's that fits his
  // per-order limit but not his month, so the server holds it for the payer (reason month_budget).
  // Your own month: four meals at three kitchens (one «للسفرة» at مشويات الحاج كريم), a الرجعة trip that
  // just ended, «وفّرت» lines and points; last month three meals and its own savings and points, for
  // the month stepper and the month-start card.
  const familySeeded = new Set();
  // POST /demo/owe?personId=…&amount=500 — an earlier unpaid amount on his wallet (a cancellation fee
  // he never paid), so the next cash checkout shows «مبلغ سابق عليك» (M-3, `CASH_DEBT_COLLECT`).
  app.use('/demo/owe', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const amount = Number(url.searchParams.get('amount') ?? 500);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/owe?personId=…&amount=…' });
      await ledger.record({ type: 'adjustment', amount, fromAccount: `customer:${personId}`, toAccount: 'bank', occurredAt: new Date(), memo: 'demo unpaid fee' });
      json(res, 200, { personId, amount });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/family', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/family?personId=…' });
      const household = (await orgs.householdsOf(personId))[0];
      if (!household) return json(res, 400, { error: 'POST /demo/account?personId=… first' });
      // Once per household: a second call would push حسين's orders over his month and hold them.
      if (familySeeded.has(household.id)) return json(res, 200, { householdId: household.id, held: null, again: true });
      familySeeded.add(household.id);
      const byName = async (phone) => identity.personIdByPhone(phone);
      const minar = await byName('07801234567');
      const hussein = await byName('07709876543');
      await orgs.setMonthlyBudget(household.id, minar, 100_000, personId);
      await orgs.setMonthlyBudget(household.id, hussein, 20_000, personId);
      const now = Date.now();
      const ago = (h) => new Date(now - h * 3_600_000);
      await ledger.recordAll(group(`demo:hh2:${household.id}`, 'money', ago(28), [{ type: 'credit_issued', amount: 150_000, fromAccount: Accounts.bank, toAccount: Accounts.household(household.id), memo: 'topup:agent' }]));
      // Days into this Baghdad month so far: this month's orders stay inside it, last month's land before it.
      const dom = new Date(now + 3 * 3_600_000).getUTCDate();
      const inMonth = (d) => Math.min(d, Math.max(0, dom - 1) + 0.2);
      const lastMonth = (d) => dom + d;
      const at = (key, lines, daysAgo, extra = {}) => ({ key, lines, daysAgo, ...extra });
      const hh = { householdOrgId: household.id };
      for (const [who, h] of [
        [minar, at('khalid', [['liver_plate', 2], ['salad', 1]], inMonth(5), hh)],
        [minar, at('sham', [['arabi_shawarma', 2], ['lemon_mint', 1]], inMonth(2), hh)],
        [hussein, at('sham', [['falafel_plate', 2], ['lemon_mint', 1]], inMonth(4), hh)],
        [hussein, at('khalid', [['liver_plate', 1], ['pepsi', 1]], inMonth(1), hh)],
        // Small ones first: a new account's first three cash orders are capped (decisions §4).
        [personId, at('khalid', [['liver_plate', 2]], lastMonth(4))],
        [personId, at('musafir', [['kahi_geymar', 2], ['iraqi_tea', 2]], lastMonth(9))],
        [personId, at('khalid', [['salad', 2], ['lentil_soup', 2]], lastMonth(15))],
        [personId, at('khalid', [['liver_plate', 1], ['pepsi', 1]], inMonth(6))],
        [personId, at('khalid', [['khalid_mix', 1], ['liver_plate', 1], ['shenina', 1]], inMonth(2))],
        [personId, at('sham', [['falafel_plate', 1], ['lemon_mint', 1]], inMonth(1))],
        [personId, at('haj_kareem', [['rice_bamia', 2], ['arabic_salad', 1], ['erbil_laban', 2]], inMonth(3), { familyTable: true })],
      ]) {
        await deliveredOrder(who, h);
      }
      // حسين's third this month: 7,000-ish fits his 10,000 limit but not what is left of his 20,000.
      const sham = seeded.find((s) => s.seed.key === 'sham');
      let held = null;
      try {
        held = await orders.place(hussein, {
          cityId: 'aziziyah',
          type: 'food',
          merchantOrgId: sham.orgId,
          lines: [['falafel_plate', 2]].map(([k, qty]) => ({ catalogItemId: sham.itemIds.get(k), qty })),
          paymentMethod: 'wallet',
          householdOrgId: household.id,
          dropoff: { zoneKey: 'zakur', pin: HOME },
        });
      } catch {
        // A closed kitchen at this hour: the hub still shows the month without it.
      }
      // «وفّرت» and points: this month and last (the same ledger lines the year sum reads).
      const customer = Accounts.customer(personId);
      const days = (d) => new Date(now - d * 86_400_000);
      await ledger.recordAll([
        group(`demo:saved:${personId}:1`, 'money', days(inMonth(3)), [{ type: 'promo_funded', amount: 1_500, fromAccount: Accounts.platform, toAccount: customer, memo: 'points:demo' }]),
        group(`demo:saved:${personId}:2`, 'money', days(inMonth(2)), [{ type: 'credit_issued', amount: 1_000, fromAccount: Accounts.platform, toAccount: customer, memo: 'late_promise' }]),
        group(`demo:saved:${personId}:3`, 'money', days(lastMonth(6)), [{ type: 'promo_funded', amount: 2_000, fromAccount: Accounts.platform, toAccount: customer, memo: 'deal:demo' }]),
        group(`demo:earned:${personId}:1`, 'points', days(inMonth(3)), [{ type: 'points_earned', amount: 120, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
        group(`demo:earned:${personId}:2`, 'points', days(lastMonth(5)), [{ type: 'points_earned', amount: 75, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(personId) }]),
      ]);
      // A الرجعة trip that just ended (this month's «رجعة وحدة»).
      await fetch(`http://127.0.0.1:${PORT}/demo/rajaa/arrived?personId=${encodeURIComponent(personId)}`, { method: 'POST' }).catch(() => null);
      json(res, 200, { householdId: household.id, held: held ? { orderId: held.id, heldForPayer: held.heldForPayer === true } : null });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── «وين الباص» (map idea N14) ─────────────────────────
//   POST /demo/khat-bus?personId=<id>[&state=coming|away|on_board|delivered|absent][&fixAgoMin=5]   (after /demo/account)
//
// Today's morning school run for the person's first خطوط child (زهراء): two neighbours' children
// (another family) are picked up before her, one more after her, then the school (المركز). The bus is
// a demo خطوط driver's fix, through the real trips/khat modules, so the guardian map shows exactly what
// the server lets out. `away` (the default): no one picked up yet, the bus heading to the first
// neighbour (busAway, two stops before yours). `coming`: both neighbours on board, the bus on the way to
// her home, well past 300 m from their stops. `on_board`: she and the third child are on, the bus
// heading to the school. `delivered`: dropped at school. `absent`: marked absent. Each call replaces
// the previous demo run.
{
  const { KhatService } = await load('modules/khat/index.js');
  const khat = app.get(KhatService);
  // All in town north of the river: the neighbours east and north of her home, the third child between
  // her home and the school.
  const P = {
    n1: { lat: 32.9135, lng: 45.068 },
    n2: { lat: 32.915, lng: 45.061 },
    home: { lat: 32.912, lng: 45.056 },
    n3: { lat: 32.9085, lng: 45.0575 },
    school: { lat: 32.905, lng: 45.06 },
  };
  /** Where the bus stands in each state (≥ 300 m from every other child's stop whenever it should show). */
  const BUS_AT = {
    away: { lat: 32.912, lng: 45.073, bearing: 290 },
    coming: { lat: 32.9125, lng: 45.059, bearing: 260 },
    on_board: { lat: 32.9058, lng: 45.0596, bearing: 150 },
    delivered: { lat: 32.905, lng: 45.06, bearing: 150 },
    absent: { lat: 32.912, lng: 45.073, bearing: 290 },
  };
  const runs = new Map(); // personId → tripId
  let khatDriver = null;
  let neighbours = null;

  app.use('/demo/khat-bus', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      const state = url.searchParams.get('state') ?? 'away';
      if (req.method !== 'POST' || !personId || !BUS_AT[state]) return json(res, 400, { error: 'POST /demo/khat-bus?personId=…&state=coming|away|on_board|delivered|absent' });
      const own = await identity.myChildren({ personId });
      if (!own.length) return json(res, 400, { error: 'POST /demo/account?personId=… first (it adds the خطوط children)' });
      const childRef = own[0].childRef;
      if (!khatDriver) {
        const phone = '07712990004';
        await identity.requestOtp({ phone, purpose: 'login' });
        const { code } = await identity.devLastOtp(phone);
        khatDriver = (await identity.verifyOtp({ phone, code })).personId;
        await identity.grantRole({ personId: 'system:demo' }, { personId: khatDriver, kind: 'khat_driver' });
        await identity.setName({ personId: khatDriver, sessionId: 'demo' }, 'كرار عادل');
        vehicles.register?.(khatDriver, { vehicleClass: 'van', plate: 'واسط 40417' });
        await dispatch.setPolicy({ personId: 'demo-dispatcher', sessionId: 'demo' }, { cityId: 'aziziyah', vertical: 'khat', suggestOnly: true }).catch(() => undefined);
      }
      // The neighbours' children belong to another family: nothing of theirs reaches this guardian.
      if (!neighbours) {
        const parent = await identity.ensurePersonByPhone('07803330399', 'system:demo', 'demo');
        neighbours = [];
        for (const name of ['سجاد حيدر', 'نور كاظم', 'آية سالم']) neighbours.push((await identity.registerChild({ personId: parent }, { name })).childRef);
      }
      const old = runs.get(personId);
      if (old) await trips.cancel(old, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
      const driver = { personId: khatDriver, sessionId: 'demo' };
      const now = Date.now();
      const w = (m) => new Date(now + m * 60_000);
      const kids = [
        [neighbours[0], P.n1, -10],
        [neighbours[1], P.n2, -5],
        [childRef, P.home, 2],
        [neighbours[2], P.n3, 6],
      ];
      const stops = kids.map(([ref, at, m]) => ({ type: 'pickup', zoneKey: 'hashimi', target: at, childRef: ref, windowStart: w(m), windowEnd: w(m + 5) }));
      for (const [ref] of kids) stops.push({ type: 'dropoff', zoneKey: 'centre', target: P.school, childRef: ref, windowStart: w(15), windowEnd: w(25) });
      const trip = await trips.createForOrders({ cityId: 'aziziyah', vertical: 'khat', orders: [], stops });
      runs.set(personId, trip.id);
      await dispatch.presence.online(khatDriver, { cityId: 'aziziyah', at: BUS_AT.away, vehicle: 'van', tier: 'silver' });
      await dispatch.request({ tripId: trip.id, cityId: 'aziziyah', vertical: 'khat', zoneId: 'hashimi', pickup: P.n1, dropoffZoneId: 'centre' });
      const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: khatDriver, reason: 'demo: khat bus', force: true });
      await dispatch.respond(driver, { offerId, accept: true });
      const s = [...(await trips.get(trip.id)).stops].sort((a, b) => a.seq - b.seq);
      const tapIn = (i) => khat.tapIn(driver, { tripId: trip.id, stopId: s[i].id, pin: kids[i][1] });
      if (state === 'absent') await khat.reportAbsence(driver, { tripId: trip.id, childRef, reason: 'guardian_notice' });
      if (state === 'coming' || state === 'on_board' || state === 'delivered') {
        await tapIn(0);
        await tapIn(1);
      }
      if (state === 'on_board' || state === 'delivered') {
        await tapIn(2);
        await tapIn(3);
      }
      if (state === 'delivered') await khat.tapOut(driver, { tripId: trip.id, stopId: s[6].id, pin: P.school });
      // `&fixAgoMin=5`: the bus's last fix is that old (the stale caption); `&fixAt=<ISO>`: taken then (shots on a fixed clock).
      const bus = BUS_AT[state];
      const fixAt = url.searchParams.get('fixAt') ? new Date(url.searchParams.get('fixAt')) : new Date(now - Number(url.searchParams.get('fixAgoMin') ?? 0) * 60_000);
      await trips.reportPosition(khatDriver, { tripId: trip.id, pin: { lat: bus.lat, lng: bus.lng }, at: fixAt, bearing: bus.bearing, speedKmh: 25 });
      const view = await khat.guardianRun({ personId, sessionId: 'demo' }, { childRef });
      json(res, 200, { tripId: trip.id, childRef, view });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── merchant deals at checkout + wallet top-up ─────────────────────────
//
//   POST /demo/deals                                 two approved, running deals on مطعم خالد (idempotent):
//                                                    "خصم 20% على كل المنيو" and "توصيل مجاني فوق 15,000 دينار";
//                                                    also keeps the kitchen open around the clock for screenshots;
//                                                    `?only=free_delivery` pauses the 20 % one (a free-delivery
//                                                    order over 15,000: its late promise is the flat 1,000 دينار)
//   POST /demo/topup/request?personId=…&amount=…     a cash top-up code for that person (as if he tapped شحن المحفظة)
//   POST /demo/ops-agent                             a field-ops agent (0770 555 0101, "حسن") for Ops mode in the
//                                                    Partner app (export it with this API's URL)
//   POST /demo/topup/confirm?code=…                  the agent confirms the cash for a code
{
  const { PromotionsService } = await load('modules/promotions/index.js');
  const { TopUpService } = await load('modules/topups/index.js');
  const { IdentityService } = await load('modules/identity/index.js');
  const promotions = app.get(PromotionsService);
  const topups = app.get(TopUpService);
  const identity = app.get(IdentityService);
  const AGENT_PHONE = '07705550101';
  const projection = { ordersPerWeek: 0, costPerOrderIqd: 0, weeklyCostIqd: 0, totalCostIqd: 0, basisOrders: 0 };
  let agentId = null;

  const ensureAgent = async () => {
    if (agentId) return agentId;
    agentId = await identity.ensurePersonByPhone(AGENT_PHONE, 'system:demo', 'demo');
    await identity.grantRole({ personId: 'system:demo' }, { personId: agentId, kind: 'field_ops' });
    await identity.updateProfile({ personId: agentId, sessionId: 'demo' }, { name: 'حسن' });
    return agentId;
  };

  app.use('/demo/deals', async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/deals' });
      // Screenshots run at any hour: the demo keeps مطعم خالد open around the clock (no opening hours).
      const front = await catalog.storefront(khalid.orgId);
      if (front && front.hours.length > 0) await catalog.saveStorefront({ ...front, hours: [] });
      const existing = await promotions.list(khalid.orgId);
      if (existing.length === 0) {
        const now = Date.now();
        const schedule = { startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 30 * 86_400_000), days: [] };
        const base = { cityId: 'aziziyah', merchantOrgId: khalid.orgId, ownerId: 'demo-owner', itemIds: [], schedule, projection, requireApproval: false };
        await promotions.propose({ ...base, type: 'percent', value: 20, nameAr: 'خصم الافتتاح', minOrderIqd: 0, budgetCapIqd: 500_000 });
        await promotions.propose({ ...base, type: 'free_delivery', value: 0, nameAr: 'توصيل مجاني', minOrderIqd: 15_000 });
      }
      // `?only=free_delivery` pauses the 20 % deal so free delivery is the one applied (a free-delivery
      // order: its honest-delay promise is the flat 1,000 دينار); without it both run again.
      const only = new URL(req.url ?? '/', 'http://x').searchParams.get('only');
      // (setActive leaves a deal already in that state alone.)
      for (const d of await promotions.list(khalid.orgId)) await promotions.setActive(khalid.orgId, d.dealId, !only || d.type === only, 'demo-owner');
      json(res, 200, (await promotions.list(khalid.orgId)).map((d) => ({ dealId: d.dealId, state: d.state, type: d.type, active: d.active })));
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/topup/request', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/topup/request?personId=…&amount=…' });
      json(res, 200, await topups.request({ personId, sessionId: 'demo' }, { amountIqd: Number(url.searchParams.get('amount') ?? 25_000) }));
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/ops-agent', async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/ops-agent' });
      json(res, 200, { personId: await ensureAgent(), phone: AGENT_PHONE });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/topup/confirm', async (req, res) => {
    try {
      const code = new URL(req.url ?? '/', 'http://x').searchParams.get('code');
      if (req.method !== 'POST' || !code) return json(res, 400, { error: 'POST /demo/topup/confirm?code=…' });
      const actor = { personId: await ensureAgent(), sessionId: 'demo' };
      const found = await topups.lookup(actor, { code }, 'ops_agent');
      json(res, 200, await topups.confirm(actor, { code, amountIqd: found.amountIqd }, 'ops_agent'));
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── chat, masked call, share-trip demo (/chat, /share) ─────────────────────────
//
//   POST /demo/chat?personId=<id>&scenario=courier|merchant|ride|support|support_empty   → {orderId, …}
//   POST /demo/chat/clock?minutes=<n>                               → shifts the chat module's clock
//
// `courier`: an order on the way (the track demo's courier) with a conversation already going —
// a quick reply, the customer's gate note, a number the courier typed (masked by the server), a
// location pin, one unread. `merchant`: the same with the kitchen (a staff member of مطعم خالد)
// asking about a swapped item. `ride`: a taxi ride with a moving car, a share-trip link already
// made → {token, path}. `support`: an order on the way where he asked the support desk about the delay
// and زينب (support) answered (one unread); `support_empty`: an order on the way, support chat unused.
// `/demo/chat/clock?minutes=31` lets a screenshot show a closed thread
// (minutes=0 resets); it only moves the chat module's clock.
//
// Voice notes (ride ideas n7/n8): in `ride` the driver has also left a 3-second voice note, and a
// voice note the customer sends to his courier / driver is answered by one from him 2.5 s later
// (scripts/dev/demo-voice-note.m4a, a soft hum made with ffmpeg; uploaded through the real store).
{
  const { ChatService } = await load('modules/chat/index.js');
  const { ShareLinksService } = await load('modules/tracking/index.js');
  const { BLOB_STORE: VOICE_STORE } = await load('modules/places/index.js');
  const chat = app.get(ChatService);
  const shareLinks = app.get(ShareLinksService);
  const voiceStore = app.get(VOICE_STORE);
  const DEMO_VOICE = readFileSync(fileURLToPath(new URL('../../../scripts/dev/demo-voice-note.m4a', import.meta.url)));
  /** The demo clip, uploaded as `ownerId`'s own voice note → upload id. */
  async function demoVoiceNote(ownerId) {
    const ticket = await voiceStore.createUpload({ ownerId, contentType: 'audio/mp4', sizeBytes: DEMO_VOICE.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await voiceStore.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'audio/mp4', bytes: DEMO_VOICE });
    return ticket.uploadId;
  }
  let skewMs = 0;
  chat.clock = { now: () => new Date(Date.now() + skewMs) };
  const as = (personId) => ({ personId, sessionId: 'demo' });
  let n = 0;
  const cid = () => `demo-${Date.now().toString(36)}-${++n}`;

  let staffId = null;
  async function kitchenStaff() {
    if (staffId) return staffId;
    const phone = '07712990001';
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    staffId = (await identity.verifyOtp({ phone, code })).personId;
    await identity.setName({ personId: staffId, sessionId: 'demo' }, 'سيف');
    await identity.grantRole({ personId: 'system:demo' }, { personId: staffId, kind: 'merchant_staff', orgId: khalid.orgId });
    return staffId;
  }

  let deskId = null;
  async function supportAgent() {
    if (deskId) return deskId;
    const phone = '07700000093';
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    deskId = (await identity.verifyOtp({ phone, code })).personId;
    await identity.setName({ personId: deskId, sessionId: 'demo' }, 'زينب');
    await identity.grantRole({ personId: 'system:demo' }, { personId: deskId, kind: 'support' });
    return deskId;
  }

  async function driverWithCar(at) {
    courierSeq += 1;
    const phone = `07713${String(450000 + courierSeq).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const driverId = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: driverId, kind: 'driver' });
    await identity.setName({ personId: driverId, sessionId: 'demo' }, 'مصطفى جاسم');
    await giveMainPhoto(driverId, 'ride:mustafa');
    vehicles.register?.(driverId, { vehicleClass: 'car', plate: 'واسط 31207', model: 'تويوتا كورولا', colour: 'white', features: ['ac'] });
    await dispatch.presence.online(driverId, { cityId: 'aziziyah', at, vehicle: 'car', tier: 'gold' });
    return driverId;
  }

  async function chatScenario(personId, name) {
    if (name === 'ride') {
      const PICKUP = { lat: 32.9012, lng: 45.0702 };
      const DROP = { lat: 32.9165, lng: 45.0585 };
      const ride = await orders.place(personId, { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: { zoneKey: 'centre', pin: PICKUP }, dropoff: { zoneKey: 'mahdood_2', pin: DROP } });
      // orders.place builds the ride's trip and broadcasts it (the dispatcher's waves): use that trip.
      const trip = await trips.activeForOrder(ride.id);
      if (!trip) throw new Error(`orders.place built no trip for ride ${ride.id}`);
      const driverId = await driverWithCar(PICKUP);
      const open = await dispatch.openOffer(driverId, 'aziziyah');
      const offerId = open && open.request.tripId === trip.id ? open.offer.id : (await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId, reason: 'demo', force: true })).offerId;
      await dispatch.respond({ personId: driverId, sessionId: 'demo' }, { offerId, accept: true });
      const pickup = (await trips.get(trip.id)).stops.find((s) => s.type === 'pickup');
      await trips.reportPosition(driverId, { tripId: trip.id, pin: PICKUP, at: new Date(), bearing: 320, speedKmh: 0 });
      await trips.arrive(trip.id, pickup.id, driverId, { pin: PICKUP });
      // A night ride (21:00–05:59) starts with the rider's code, as on /demo/ride/advance.
      const startCode = (await orders.startCodeOf(ride.id)) ?? undefined;
      await trips.completeStop(trip.id, pickup.id, driverId, startCode ? { startCode } : {});
      await startMover(trip.id, driverId, [PICKUP, { lat: 32.9061, lng: 45.0671 }, { lat: 32.9105, lng: 45.0632 }, { lat: 32.9139, lng: 45.0603 }, DROP], 26);
      await chat.send(as(driverId), { orderId: ride.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_outside' });
      await chat.send(as(driverId), { orderId: ride.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: await demoVoiceNote(driverId), durationSec: 4 });
      const link = await shareLinks.createShareLink(as(personId), { orderId: ride.id });
      return { orderId: ride.id, tripId: trip.id, driverId, token: link.token, path: link.path };
    }
    const { orderId, tripId, courierId } = await scenario(personId, 'on_the_way');
    if (name === 'support_empty') return { orderId, tripId, courierId };
    if (name === 'support') {
      // «احجي ويا الدعم»: he asked the desk about the late order; زينب (support) answered.
      const desk = await supportAgent();
      await chat.send(as(personId), { orderId, kind: 'customer_support', clientId: cid(), quickReplyKey: 'customer_support_late' });
      await chat.send(as(personId), { orderId, kind: 'customer_support', clientId: cid(), text: 'صارله ساعة إلا ربع والدليفري بعده بالطريق' });
      await chat.send(as(desk), { orderId, kind: 'customer_support', clientId: cid(), text: 'هلا بيك، شفت طلبك. الدليفري علق بزحمة الجسر ويوصلك خلال 10 دقايق، وآسفين على التأخير' });
      return { orderId, tripId, courierId, supportId: desk };
    }
    if (name === 'merchant') {
      const staff = await kitchenStaff();
      await chat.send(as(personId), { orderId, kind: 'customer_merchant', clientId: cid(), quickReplyKey: 'customer_have_note' });
      await chat.send(as(personId), { orderId, kind: 'customer_merchant', clientId: cid(), text: 'الكبدة بدون بصل لو سمحتوا' });
      await chat.send(as(staff), { orderId, kind: 'customer_merchant', clientId: cid(), text: 'تمام، سوّيناها بدون بصل' });
      await chat.send(as(staff), { orderId, kind: 'customer_merchant', clientId: cid(), quickReplyKey: 'merchant_left_with_courier' });
      return { orderId, tripId, courierId, staffId: staff };
    }
    await chat.send(as(courierId), { orderId, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_on_the_way' });
    await chat.send(as(personId), { orderId, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'customer_other_gate' });
    await chat.send(as(personId), { orderId, kind: 'customer_courier', clientId: cid(), text: 'الباب الأزرق يم الصيدلية، الطابق الأرضي' });
    await chat.markRead(as(courierId), { orderId, kind: 'customer_courier', seq: 3 });
    await chat.send(as(courierId), { orderId, kind: 'customer_courier', clientId: cid(), text: 'تمام. إذا ما لگيته اتصل بيه على 0770 123 4567' });
    await chat.send(as(courierId), { orderId, kind: 'customer_courier', clientId: cid(), location: { lat: 32.8921, lng: 45.0731 } });
    await chat.send(as(courierId), { orderId, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_two_min' });
    return { orderId, tripId, courierId };
  }

  // His voice note to the courier / driver gets one back (the demo plays the other side).
  events.subscribe('demo:voice-reply', ['chat.message_sent'], async (event) => {
    const p = event.payload;
    if (p.messageKind !== 'voice' || p.senderRole !== 'customer' || p.kind !== 'customer_courier' || p.recipientIds.length === 0) return;
    const courierId = p.recipientIds[0];
    setTimeout(() => {
      void demoVoiceNote(courierId)
        .then((voiceUploadId) => chat.send(as(courierId), { orderId: p.orderId, kind: 'customer_courier', clientId: cid(), voiceUploadId, durationSec: 4 }))
        .catch((err) => console.warn(`[demo] voice reply: ${err?.message ?? err}`));
    }, 2500);
  });

  app.use('/demo/chat', async (req, res) => {
    try {
      const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
      if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
      if (url.pathname.endsWith('/clock')) {
        skewMs = Number(url.searchParams.get('minutes') ?? 0) * 60_000;
        return json(res, 200, { skewMinutes: skewMs / 60_000 });
      }
      const personId = url.searchParams.get('personId');
      const name = url.searchParams.get('scenario') ?? 'courier';
      if (!personId || !['courier', 'merchant', 'ride', 'support', 'support_empty'].includes(name)) return json(res, 400, { error: 'POST /demo/chat?personId=…&scenario=courier|merchant|ride|support|support_empty' });
      json(res, 200, { scenario: name, ...(await chatScenario(personId, name)) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── city taxi / tuktuk demo ─────────────────────────
// Booking happens in the app (orders.place type ride → the API builds the trip and broadcasts it).
// This section only plays the drivers:
//   POST /demo/ride[?acceptMs=3000]   four taxis and three tuktuks online, cruising small loops around
//                                     the centre while free (the booking map's nearby vehicles; idempotent);
//                                     the nearest one offered a ride accepts after acceptMs
//                                     (DEMO_RIDE_ACCEPT_MS, default 3000; 0 = hold every offer)
//   POST /demo/ride/accept?orderId=…  accept that ride's open offer now
//   POST /demo/ride/advance?orderId=… one step: to pickup → at pickup → on the trip → arrived (cash paid)
//   POST /demo/ride/search-age?orderId=…&sec=200  the ride reads as searching for `sec` (the 3-minute offer)
//   POST /demo/ride?acceptMs=0[&nudgeAcceptMs=4000]  hold every offer: the rider watches the drivers it was
//                                     sent to (dispatch.myRideOffers: sent → شافه after 1.5 s), and a driver he
//                                     nudges («نبّهه») accepts nudgeAcceptMs after the nudge (0 = never)
//   (/demo/ride/accept re-sends the ride to the nearest free driver when every held offer ran out)
//   POST /demo/ride/nudges?orderId=…  the drivers sent that ride and which were nudged (what each one's
//                                     partner app shows as «راكب ينتظرك»)
//   POST /demo/ride/night?orderId=…   the ride gets a night ride's 4-digit trip code (s1) by day: the live
//                                     screen shows «رمز المشوار»; advance passes it like the rider would
{
  const RIDE_DRIVERS = [
    // Ride step 3 (d1, n1, n2): model, the real colour and the features ops confirmed at the car check.
    { name: 'حسين علي', vehicle: 'car', plate: 'واسط 27415', model: 'كيا سيراتو', colour: 'silver', features: ['ac', 'no_smoking'], at: { lat: 32.9068, lng: 45.0591 } },
    { name: 'مصطفى جاسم', vehicle: 'car', plate: 'واسط 31207', model: 'تويوتا كورولا', colour: 'white', features: ['ac', 'heating', 'family'], at: { lat: 32.9031, lng: 45.0667 } },
    { name: 'عباس كريم', vehicle: 'tuktuk', plate: 'واسط 8841', model: 'باجاج', colour: 'red', features: [], at: { lat: 32.9112, lng: 45.0618 } },
    { name: 'سجاد فاضل', vehicle: 'tuktuk', plate: 'واسط 9206', model: 'باجاج', colour: 'blue', features: ['family'], at: { lat: 32.9019, lng: 45.0579 } },
    { name: 'كرار حسن', vehicle: 'car', plate: 'واسط 40318', model: 'هيونداي النترا', colour: 'black', features: ['big_boot'], at: { lat: 32.9102, lng: 45.0702 } },
    { name: 'علي ناصر', vehicle: 'car', plate: 'واسط 15562', model: 'تويوتا كامري', colour: 'white', features: ['ac', 'heating', 'child_seat'], at: { lat: 32.8996, lng: 45.0631 } },
    { name: 'مرتضى سالم', vehicle: 'tuktuk', plate: 'واسط 7713', model: 'باجاج', colour: 'green', features: [], at: { lat: 32.9077, lng: 45.0712 } },
  ];
  // Ride step 3: the car facts riders see on the offered-drivers list and the profile (model, colour,
  // confirmed tags; trip count from his completed trips) — the in-memory port in the demo.
  const { VEHICLE_FACTS } = await load('modules/dispatch/index.js');
  const facts = app.get(VEHICLE_FACTS);
  /** Metres per 500 ms tick while free: ≈ 36 km/h for a car, 25 for a tuktuk. */
  const CRUISE_M = { car: 5, tuktuk: 3.5 };
  /** A free driver drives a small block (≈ 270 × 260 m) around where he became free. */
  function cruise(d) {
    if (!d.loop) {
      const c = d.pos;
      d.loop = { pts: [{ lat: c.lat + 0.0024, lng: c.lng }, { lat: c.lat + 0.0024, lng: c.lng + 0.0028 }, { lat: c.lat, lng: c.lng + 0.0028 }, { ...c }], i: 0 };
    }
    let left = CRUISE_M[d.def.vehicle] ?? 4;
    while (left > 0) {
      const to = d.loop.pts[d.loop.i];
      const dist = metres(d.pos, to);
      if (dist <= left) {
        d.pos = { ...to };
        d.loop.i = (d.loop.i + 1) % d.loop.pts.length;
        left -= dist;
      } else {
        const k = left / dist;
        d.pos = { lat: d.pos.lat + (to.lat - d.pos.lat) * k, lng: d.pos.lng + (to.lng - d.pos.lng) * k };
        left = 0;
      }
    }
  }
  const drivers = []; // { id, def, pos, tripId }
  const rides = new Map(); // orderId → { tripId, driverId, step }
  let acceptMs = Number(process.env.DEMO_RIDE_ACCEPT_MS ?? 3000);
  /** A nudged driver («راكب ينتظرك») answers this long after the nudge, even when offers are held (0 = never). */
  let nudgeAcceptMs = Number(process.env.DEMO_RIDE_NUDGE_ACCEPT_MS ?? 4000);
  /** He opens the offer (state «شافه») this long after it rings. */
  const SEEN_AFTER_MS = 1500;
  const seen = new Map(); // offerId → first seen (ms)

  async function rideDriver(def, i) {
    const phone = `07714${String(560000 + i).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'driver' });
    await identity.setName({ personId: id, sessionId: 'demo' }, def.name);
    await giveMainPhoto(id, `ride:${def.name}`);
    vehicles.register?.(id, { vehicleClass: def.vehicle, plate: def.plate, model: def.model, colour: def.colour, features: def.features });
    facts.register?.(id, { vehicleClass: def.vehicle, model: def.model, colour: def.colour, confirmedFeatures: def.features });
    await dispatch.presence.online(id, { cityId: 'aziziyah', at: def.at, vehicle: def.vehicle, tier: 'gold' });
    // Joy l2: riders see his rating on the reveal (six rated past jobs; demo only).
    if (process.env.DEMO_RIDE_RATED !== "0") await ratedHistory(id, { force: true });
    await dispatch.presence.heartbeat(id, def.at).catch(() => undefined);
    return { id, def, pos: { ...def.at }, tripId: null };
  }

  async function ensureDrivers() {
    if (drivers.length === 0) for (const [i, def] of RIDE_DRIVERS.entries()) drivers.push(await rideDriver(def, i));
    return drivers;
  }

  async function acceptOffer(d, offerId) {
    const out = await dispatch.respond({ personId: d.id, sessionId: 'demo' }, { offerId, accept: true });
    if (out.outcome !== 'assigned') return null;
    const tripId = out.tripId;
    const trip = await trips.get(tripId);
    const orderId = trip.stops.find((s) => s.orderId)?.orderId;
    const pickup = trip.stops.find((s) => s.type === 'pickup');
    d.tripId = tripId;
    d.loop = null;
    rides.set(orderId, { tripId, driverId: d.id, step: 'to_pickup', driver: d });
    // He drives to the pickup: a fix every 2 s along a straight-ish line.
    const mid = { lat: (d.pos.lat + pickup.target.lat) / 2 + 0.0006, lng: (d.pos.lng + pickup.target.lng) / 2 - 0.0004 };
    await startMover(tripId, d.id, [d.pos, mid, pickup.target], 22);
    return orderId;
  }

  // The auto-accept loop: every driver's open offer, accepted once it has been open acceptMs.
  setInterval(async () => {
    for (const d of drivers) {
      try {
        if (d.tripId) continue;
        cruise(d);
        await dispatch.presence.heartbeat(d.id, d.pos).catch(() => undefined);
        const open = await dispatch.openOffer(d.id, 'aziziyah');
        if (!open) continue;
        const first = seen.get(open.offer.id) ?? Date.now();
        seen.set(open.offer.id, first);
        if (open.offer.state === 'sent' && Date.now() - first >= SEEN_AFTER_MS)
          await dispatch.offerSeen({ personId: d.id, sessionId: 'demo' }, { offerId: open.offer.id, foregroundMs: 60_000 }).catch(() => undefined);
        const nudgedAt = open.offer.nudgedAt?.getTime() ?? null;
        if (acceptMs > 0 && Date.now() - first >= acceptMs) await acceptOffer(d, open.offer.id);
        else if (nudgedAt !== null && nudgeAcceptMs > 0 && Date.now() - nudgedAt >= nudgeAcceptMs) await acceptOffer(d, open.offer.id);
      } catch (err) {
        console.error('ride demo', err?.message ?? err);
      }
    }
  }, 500);

  async function advanceRide(orderId) {
    const r = rides.get(orderId);
    if (!r) throw new Error(`no accepted demo ride ${orderId}`);
    const trip = await trips.get(r.tripId);
    const pickup = trip.stops.find((s) => s.type === 'pickup');
    const drop = trip.stops.find((s) => s.type === 'dropoff');
    if (r.step === 'to_pickup') {
      stopMover(r.tripId);
      await trips.reportPosition(r.driverId, { tripId: r.tripId, pin: pickup.target, at: new Date(), bearing: 200, speedKmh: 0 });
      await trips.arrive(r.tripId, pickup.id, r.driverId, { pin: pickup.target });
      r.step = 'at_pickup';
    } else if (r.step === 'at_pickup') {
      // A night ride starts with the rider's code (ride step 3, s1): the demo driver "asks" for it.
      const startCode = (await orders.startCodeOf(orderId)) ?? undefined;
      await trips.completeStop(r.tripId, pickup.id, r.driverId, startCode ? { startCode } : {});
      const mid = { lat: (pickup.target.lat + drop.target.lat) / 2 + 0.0008, lng: (pickup.target.lng + drop.target.lng) / 2 + 0.0006 };
      await startMover(r.tripId, r.driverId, [pickup.target, mid, drop.target], 30);
      r.step = 'on_trip';
    } else if (r.step === 'on_trip') {
      stopMover(r.tripId);
      await trips.reportPosition(r.driverId, { tripId: r.tripId, pin: drop.target, at: new Date(), bearing: 330, speedKmh: 0 });
      await trips.arrive(r.tripId, drop.id, r.driverId, { pin: drop.target });
      const order = await orders.get(orderId);
      await trips.completeStop(r.tripId, drop.id, r.driverId, { handover: { cashCollectedIqd: order.paymentMethod === 'cash' ? order.totalIqd : 0 } });
      r.driver.pos = { ...drop.target };
      r.driver.tripId = null;
      r.step = 'arrived';
    }
    return r.step;
  }

  app.use('/demo/ride', async (req, res) => {
    try {
      const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
      if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
      const orderId = url.searchParams.get('orderId');
      if (url.pathname.endsWith('/advance')) return json(res, 200, { orderId, step: await advanceRide(orderId) });
      if (url.pathname.endsWith('/night')) {
        // Ride step 3 (s1) by day: the ride gets the 4-digit trip code a night ride is placed with
        // (in-memory record only), so «رمز المشوار» shows and the partner app asks for it.
        const { ORDERS_REPOSITORY, newStartCode } = await load('modules/orders/index.js');
        const order = await orders.get(orderId);
        if (order.type !== 'ride') return json(res, 409, { error: 'not a ride' });
        const startCode = (await orders.startCodeOf(orderId)) ?? newStartCode();
        await app.get(ORDERS_REPOSITORY).update(orderId, { startCode });
        return json(res, 200, { orderId, startCode });
      }
      if (url.pathname.endsWith('/search-age')) {
        // The 3-minute offer (J-D7) without waiting 3 minutes: the ride reads as placed `sec` ago
        // (in-memory record only; the dispatch search itself keeps its own clock).
        const { ORDERS_REPOSITORY } = await load('modules/orders/index.js');
        const sec = Number(url.searchParams.get('sec') ?? 200);
        await app.get(ORDERS_REPOSITORY).update(orderId, { placedAt: new Date(Date.now() - sec * 1000) });
        return json(res, 200, { orderId, placedAt: (await orders.get(orderId)).placedAt });
      }
      if (url.pathname.endsWith('/nudges')) {
        const trip = await trips.activeForOrder(orderId);
        if (!trip) return json(res, 404, { error: 'no trip' });
        const search = await dispatch.searchOf(trip.id);
        const names = new Map((await ensureDrivers()).map((d) => [d.id, d.def.name]));
        return json(res, 200, {
          orderId,
          tripId: trip.id,
          searching: Boolean(search),
          offers: (search?.offers ?? []).map((o) => ({ offerId: o.id, driverId: o.driverId, name: names.get(o.driverId) ?? null, state: o.state, nudgedAt: o.nudgedAt })),
        });
      }
      if (url.pathname.endsWith('/accept')) {
        const trip = await trips.activeForOrder(orderId);
        if (!trip) return json(res, 404, { error: 'no trip' });
        for (const d of await ensureDrivers()) {
          const open = await dispatch.openOffer(d.id, 'aziziyah');
          if (open && open.request.tripId === trip.id) return json(res, 200, { orderId: await acceptOffer(d, open.offer.id) });
        }
        // Every driver it was sent to let it run out (offers held for the shots): the dispatcher sends it
        // again to the nearest free driver of that vehicle, the way the Console's manual assign does, and he takes it.
        const search = await dispatch.searchOf(trip.id);
        if (search) {
          const want = search.request.vertical === 'tuktuk' ? 'tuktuk' : 'car';
          const free = drivers.filter((d) => !d.tripId && d.def.vehicle === want).sort((a, b) => metres(a.pos, trip.stops[0].target) - metres(b.pos, trip.stops[0].target))[0];
          if (free) {
            const { offerId } = await dispatch.override({ personId: 'system:demo', sessionId: 'demo' }, { tripId: trip.id, driverId: free.id, reason: 'demo: held offers ran out', force: true });
            return json(res, 200, { orderId: await acceptOffer(free, offerId) });
          }
        }
        return json(res, 409, { error: 'no open offer for that ride yet' });
      }
      if (url.searchParams.has('acceptMs')) acceptMs = Number(url.searchParams.get('acceptMs'));
      if (url.searchParams.has('nudgeAcceptMs')) nudgeAcceptMs = Number(url.searchParams.get('nudgeAcceptMs'));
      const list = await ensureDrivers();
      json(res, 200, { acceptMs, nudgeAcceptMs, drivers: list.map((d) => ({ id: d.id, name: d.def.name, vehicle: d.def.vehicle, busy: Boolean(d.tripId) })) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // ───────────────────────── ride ideas c9/s3: a ride for someone else ─────────────────────────
  //   POST /demo/ride-for?personId=…   → {earlierOrderId}
  // «لمنو المشوار؟» has people to offer: two trusted people (أختي زينب, أبوي; kept when he has some) and
  // «ماما», whom he booked a taxi for earlier (cancelled before a driver took it, so nothing is running).
  // Book a ride for someone in the app; /demo/ride/accept and /advance drive it like any ride.
  app.use('/demo/ride-for', async (req, res) => {
    try {
      const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
      const personId = url.searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/ride-for?personId=…' });
      const as = { personId, sessionId: 'demo' };
      if (((await identity.me(as)).trustedContacts ?? []).length === 0) {
        await identity.updateProfile(as, {
          trustedContacts: [
            { name: 'أختي زينب', phone: '0780 111 2233', relation: 'sibling' },
            { name: 'أبوي', phone: '0790 222 3344', relation: 'father' },
          ],
        });
      }
      const earlier = await orders.place(personId, {
        cityId: 'aziziyah',
        type: 'ride',
        rideVertical: 'taxi',
        pickup: { zoneKey: 'centre', pin: { lat: 32.9012, lng: 45.0702 } },
        dropoff: { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } },
        rider: { from: 'typed', name: 'ماما', phone: '0770 555 4433' },
      });
      await orders.cancel(personId, { orderId: earlier.id, reason: 'demo' });
      json(res, 200, { earlierOrderId: earlier.id });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  // ───────────────────────── joy J7d: ride habits ─────────────────────────
  //   POST /demo/ride-habits?personId=…   → {regularRideId, rideDate, regularRajaaId, rajaaDate, bookedOrderId, rajaaBookingId}
  // Home and الدائرة saved (when missing); two taxi rides finished today, both rated 5 — حسين علي kept as
  // a favourite, مصطفى جاسم offered as «خليه سايقك المفضل؟»; a الرجعة from Kut with جاسم rated 5 and kept,
  // whose next car to Kut leaves the Gate 1 garage in about 75 minutes; two regular trips asking now —
  // البيت ← الدائرة every day about 3 hours from now (with حسين), Aziziyah → Kut about an hour from now
  // (with جاسم) — and the work trip's next day already booked (a ride for later, حسين asked first).
  //   POST /demo/dinner?personId=…[&kind=rajaa]   → {orderId} | {bookingId}
  // «عشاك يوصل وياك»: a taxi from الدائرة to البيت on the trip now (home and checkout offer dinner), or
  // with kind=rajaa a seat from Kut to Aziziyah leaving in 30 minutes (its pass offers dinner).
  {
    const { RideHabitsService } = await load('modules/ride-habits/index.js');
    const { DeparturesService: J7Departures, RoutesRpc: J7Routes } = await load('modules/routes/index.js');
    const { SavedPlacesService: J7Places } = await load('modules/places/index.js');
    const habits = app.get(RideHabitsService);
    const j7deps = app.get(J7Departures);
    const j7routes = app.get(J7Routes);
    const j7places = app.get(J7Places);
    const WORK = { lat: 32.9139, lng: 45.0603 };
    const MIN = 60_000;
    const MIN5 = 5 * MIN;
    const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
    const actor = (personId) => ({ personId, sessionId: 'demo' });
    const at5 = (ms) => new Date(Math.ceil(ms / MIN5) * MIN5);
    const saloon = (plate, model, color) => ({ kind: 'saloon', layout: 4, plate, ...demoModel(model), color });
    const point = (p) => ({ zoneKey: p.zoneId, pin: p.pin, placeId: p.id });
    /** Baghdad minutes since midnight of an instant. */
    const minuteOfDay = (d) => {
      const local = new Date(d.getTime() + 3 * 3_600_000);
      return local.getUTCHours() * 60 + local.getUTCMinutes();
    };
    const nextDate = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

    async function homeAndWork(personId) {
      const mine = await j7places.mine(personId);
      const home = mine.find((p) => p.label === 'home') ?? (await j7places.save(personId, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: HOME, photoIds: [], shareWithHousehold: false, clientRef: 'demo-j7d-home' }));
      const work = mine.find((p) => p.label === 'work') ?? (await j7places.save(personId, { cityId: 'aziziyah', label: 'work', name: 'الدائرة', pin: WORK, photoIds: [], shareWithHousehold: false, clientRef: 'demo-j7d-work' }));
      return { home, work };
    }

    /** A ride with that demo driver, driven to the end and rated. */
    async function finishedRide(personId, driverName, from, to, stars) {
      const d = (await ensureDrivers()).find((x) => x.def.name === driverName && !x.tripId);
      if (!d) throw new Error(`demo driver ${driverName} is busy`);
      const ride = await orders.place(personId, { cityId: 'aziziyah', type: 'ride', rideVertical: d.def.vehicle === 'tuktuk' ? 'tuktuk' : 'taxi', pickup: point(from), dropoff: point(to), paymentMethod: 'cash' });
      const trip = await trips.activeForOrder(ride.id);
      const { offerId } = await dispatch.override(dispatcher, { tripId: trip.id, driverId: d.id, reason: 'demo', force: true });
      await acceptOffer(d, offerId);
      for (let i = 0; i < 3; i += 1) await advanceRide(ride.id);
      await orders.rate(personId, { orderId: ride.id, delivery: stars });
      return ride.id;
    }

    let j7seq = 0;
    /** A named الرجعة driver with an approved photo (a fresh one per call: runs may not overlap). */
    async function namedRajaaDriver(name) {
      j7seq += 1;
      const phone = `07716${String(770000 + j7seq).padStart(6, '0')}`;
      await identity.requestOtp({ phone, purpose: 'login' });
      const { code } = await identity.devLastOtp(phone);
      const id = (await identity.verifyOtp({ phone, code })).personId;
      await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'intercity_driver' });
      await identity.setName({ personId: id, sessionId: 'demo' }, name);
      await giveMainPhoto(id, `rajaa:j7d:${j7seq}`);
      return id;
    }

    /** A whole Kut → Aziziyah trip with that driver, arrived and rated 5. */
    async function rajaaTripDone(personId, driverId) {
      const departAt = at5(Date.now() + 10 * MIN);
      const dep = await j7deps.announce(driverId, { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', departAt, latestDepartureAt: new Date(departAt.getTime() + 30 * MIN), vehicle: saloon('52318 واسط', 'سوناتا', 'فضية'), familyOnly: false });
      const held = await j7deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_right'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
      const booked = await j7deps.book(personId, held.id, 'cash');
      await j7deps.selfie(driverId, dep.id, 'demo/selfie.jpg');
      for (const seatId of ['front', 'back_left', 'back_middle']) await j7deps.markWalkUp(driverId, dep.id, { seatId, travellingAs: 'rijal' });
      await j7deps.checkIn(driverId, dep.id, booked.pin);
      await j7deps.depart(driverId, dep.id);
      await j7deps.arrive(driverId, dep.id);
      await j7routes.rateBooking(actor(personId), { bookingId: booked.id, stars: 5, tags: [] });
      return booked.id;
    }

    app.use('/demo/ride-habits', async (req, res) => {
      try {
        const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
        if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/ride-habits?personId=…' });
        const a = actor(personId);
        const { home, work } = await homeAndWork(personId);
        const first = await finishedRide(personId, 'حسين علي', home, work, 5);
        await habits.favourite(a, { orderId: first, on: true });
        await finishedRide(personId, 'مصطفى جاسم', work, home, 5);
        const jasim = await namedRajaaDriver('جاسم محمد');
        const rajaaBookingId = await rajaaTripDone(personId, jasim);
        const favs = await habits.favourite(a, { bookingId: rajaaBookingId, on: true });
        const next = at5(Date.now() + 75 * MIN);
        await j7deps.announce(jasim, { garageId: 'mp_garage_bab1', corridorId: 'aziziyah_kut', departAt: next, latestDepartureAt: new Date(next.getTime() + 30 * MIN), vehicle: saloon('52318 واسط', 'سوناتا', 'فضية'), familyOnly: false });
        const favTaxi = favs.find((f) => f.kinds.includes('taxi')) ?? null;
        const favRajaa = favs.find((f) => f.kinds.includes('intercity')) ?? null;
        const everyDay = [0, 1, 2, 3, 4, 5, 6];
        const rideTrip = await habits.regularSave(a, {
          days: everyDay,
          timeMin: minuteOfDay(at5(Date.now() + 3 * 3_600_000)),
          remind: 'evening',
          paymentMethod: 'cash',
          favouriteId: favTaxi?.id ?? null,
          active: true,
          plan: { kind: 'ride', rideVertical: 'taxi', pickup: { ...point(home), label: home.name }, dropoff: { ...point(work), label: work.name }, doorPickup: false },
        });
        const rajaaTrip = await habits.regularSave(a, {
          days: everyDay,
          timeMin: minuteOfDay(at5(Date.now() + 60 * MIN)),
          remind: 'evening',
          paymentMethod: 'cash',
          favouriteId: favRajaa?.id ?? null,
          active: true,
          plan: { kind: 'rajaa', corridorId: 'aziziyah_kut', direction: 'from_aziziyah', garageId: 'mp_garage_bab1', travellingAs: 'rijal' },
        });
        // The work trip's next day, booked already: a ride for later with حسين asked first.
        const bookDate = nextDate(rideTrip.next.date);
        const occ = await habits.occurrence(a, { id: rideTrip.id, date: bookDate });
        const booked = await habits.confirm(a, { id: rideTrip.id, date: bookDate, fareIqd: occ.ride.fareIqd, clientRequestId: `demo-j7d-${Date.now().toString(36)}` });
        json(res, 200, { regularRideId: rideTrip.id, rideDate: rideTrip.next.date, regularRajaaId: rajaaTrip.id, rajaaDate: rajaaTrip.next.date, bookedOrderId: booked.occurrence.orderId, rajaaBookingId });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });

    // Step 4 o4: POST /demo/same-ride?personId=… → {deepLink}: the link «نفس مشوار البارحة؟» carries for
    // البيت ← الدائرة by taxi (what the push opens: the choose screen with both ends and the vehicle).
    app.use('/demo/same-ride', async (req, res) => {
      try {
        const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
        if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/same-ride?personId=…' });
        const { encodeRideEnd } = await import('@driver/contracts');
        const { home, work } = await homeAndWork(personId);
        const deepLink = `driver://ride/again?from=${encodeRideEnd(point(home))}&to=${encodeRideEnd(point(work))}&v=taxi&door=0`;
        json(res, 200, { deepLink });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });

    app.use('/demo/dinner', async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const personId = url.searchParams.get('personId');
        if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/dinner?personId=…[&kind=rajaa]' });
        const { home, work } = await homeAndWork(personId);
        if (url.searchParams.get('kind') === 'rajaa') {
          const driverId = await namedRajaaDriver('ليث حسن');
          const departAt = at5(Date.now() + 30 * MIN);
          const dep = await j7deps.announce(driverId, { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', departAt, latestDepartureAt: new Date(departAt.getTime() + 30 * MIN), vehicle: saloon('60412 واسط', 'كامري', 'بيضاء'), familyOnly: false });
          const held = await j7deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_left'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
          const booked = await j7deps.book(personId, held.id, 'cash');
          return json(res, 200, { bookingId: booked.id });
        }
        // Not the two drivers /demo/ride-habits rides with, so both hooks can run in any order.
        const d = (await ensureDrivers()).find((x) => !x.tripId && x.def.vehicle === 'car' && !['حسين علي', 'مصطفى جاسم'].includes(x.def.name));
        if (!d) throw new Error('no free demo taxi');
        const ride = await orders.place(personId, { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: point(work), dropoff: point(home), paymentMethod: 'cash' });
        const trip = await trips.activeForOrder(ride.id);
        const { offerId } = await dispatch.override(dispatcher, { tripId: trip.id, driverId: d.id, reason: 'demo', force: true });
        await acceptOffer(d, offerId);
        await advanceRide(ride.id); // at the pickup
        await advanceRide(ride.id); // on the trip, driving home
        json(res, 200, { orderId: ride.id });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });

    // ───────── review #28: evening-before booked rides ─────────
    //   POST /demo/booked-ride?personId=…[&state=looking|confirmed]   → {orderId, tripId, scheduledFor}
    // A taxi from البيت to الدائرة booked for 7:30 tomorrow (the day after when it is already 21:00 or
    // later, so the evening offer is still to come). `looking`: drivers are asked until 22:00 the evening
    // before («ندوّرلك سايق، نأكدلك قبل الساعة 10 بالليل»). `confirmed`: the evening offer is opened now
    // (the demo can't wait for 18:00) and حسين علي confirms it through the real path («سايقك محجوز: حسين»,
    // with his approved photo, and the rider's push).
    const { DISPATCH_STORE: J28Store } = await load('modules/dispatch/dispatch.store.js');
    const { OfferOrchestrator: J28Orchestrator } = await load('modules/dispatch/offer.orchestrator.js');
    const bookedStore = app.get(J28Store);
    const bookedOrchestrator = app.get(J28Orchestrator);

    /** Opens a booked ride's evening offer now, to everyone (demo only: the real one opens at 18:00). */
    async function openBookedNow(tripId) {
      const r = await bookedStore.getRequest(tripId);
      if (!r?.booked) throw new Error(`ride ${tripId} has no evening-before offer`);
      const now = Date.now();
      r.booked = { ...r.booked, offerAt: Math.min(r.booked.offerAt, now), favouriteUntil: Math.min(r.booked.favouriteUntil, now) };
      await bookedStore.saveRequest(r);
      await bookedOrchestrator.onTimer({ kind: 'booked_open', tripId, epoch: r.epoch, step: 0 });
    }

    app.use('/demo/booked-ride', async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const personId = url.searchParams.get('personId');
        const state = url.searchParams.get('state') ?? 'looking';
        if (req.method !== 'POST' || !personId || !['looking', 'confirmed'].includes(state)) return json(res, 400, { error: 'POST /demo/booked-ride?personId=…[&state=looking|confirmed]' });
        const { home, work } = await homeAndWork(personId);
        const local = new Date(Date.now() + 3 * 3_600_000);
        const ahead = local.getUTCHours() < 21 ? 1 : 2;
        const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead)).toISOString().slice(0, 10);
        const scheduledFor = new Date(`${date}T07:30:00+03:00`);
        const ride = await orders.place(personId, { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: point(home), dropoff: point(work), paymentMethod: 'cash', scheduledFor });
        const trip = await trips.activeForOrder(ride.id);
        if (state === 'confirmed') {
          await openBookedNow(trip.id);
          // حسين first; when an earlier call already gave him a ride at that time (an hour apart at
          // least), the next demo taxi driver takes it.
          const cars = (await ensureDrivers()).filter((x) => x.def.vehicle === 'car').sort((a, b) => Number(b.def.name === 'حسين علي') - Number(a.def.name === 'حسين علي'));
          let taken = false;
          for (const d of cars) {
            await dispatch.presence.heartbeat(d.id, d.pos).catch(() => undefined);
            try {
              await dispatch.answerBookedJob(d.id, trip.id, 'confirm');
              taken = true;
              break;
            } catch (err) {
              if (err?.code !== 'booked_job_clash') throw err;
            }
          }
          if (!taken) throw new Error('every demo taxi driver already has a booked ride at that time');
        }
        json(res, 200, { orderId: ride.id, tripId: trip.id, scheduledFor: scheduledFor.toISOString() });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });

    // ───────── «دفترك ويا درايفر» (stats & savings) ─────────
    //   POST /demo/stats?personId=…   → {meals, rides, seats}
    // This year so far, back-dated in memory: 30 meals from four kitchens (كبدة مطعم خالد the favourite,
    // mostly Thursday and Friday nights, 3 of them late), 14 taxi and tuktuk rides (most to الدائرة,
    // the driver 4–9 minutes away), three الرجعة seats to Baghdad (one the return leg, one with a child
    // on the lap) and one to Kut, and what came off his bills each month (kitchen deals, our
    // promotions, points against fees, the return-trip discount) plus one late-delivery credit.
    const { LedgerService: StatsLedger, Accounts: StatsAccounts } = await load('modules/ledger/index.js');
    const statsLedger = app.get(StatsLedger);
    const DAY = 86_400_000;
    /** A Baghdad wall-clock time `daysAgo` days back. */
    const baghdadAt = (daysAgo, hour, minute = 0) => {
      const local = new Date(Date.now() + 3 * 3_600_000 - daysAgo * DAY);
      return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - 3 * 3_600_000);
    };
    /** Moves an in-memory order's times so it was placed at `at` and reached the door `doorMin` later. */
    const backdate = (orderId, at, doorMin) => {
      const rec = orders.repo?.orders?.get?.(orderId);
      if (!rec) return;
      const shift = rec.placedAt.getTime() - at.getTime();
      for (const f of ['placedAt', 'acceptedAt', 'preparingAt', 'readyAt', 'pickedUpAt', 'deliveredAt', 'closedAt', 'completedAt', 'merchantOfferedAt', 'promisedReadyAt']) {
        if (rec[f] instanceof Date) rec[f] = new Date(rec[f].getTime() - shift);
      }
      if (doorMin != null && rec.deliveredAt instanceof Date) rec.deliveredAt = new Date(at.getTime() + doorMin * 60_000);
    };
    const MEALS = [
      // [kitchen, lines, daysAgo, hour, minutes to the door, late]
      ['khalid', [['liver_plate', 1]], 276, 21, 34],
      ['khalid', [['liver_plate', 1], ['pepsi', 1]], 262, 22, 31],
      ['sham', [['arabi_shawarma', 1]], 250, 20, 28],
      ['khalid', [['khalid_mix', 1], ['salad', 1]], 241, 14, 36],
      ['musafir', [['kahi_geymar', 2], ['iraqi_tea', 2]], 229, 8, 26],
      ['khalid', [['liver_plate', 2]], 218, 21, 39],
      ['haj_kareem', [['rice_bamia', 2], ['erbil_laban', 2]], 205, 13, 41, true],
      ['sham', [['arabi_shawarma', 1], ['lemon_mint', 1]], 196, 23, 27],
      ['khalid', [['liver_plate', 1], ['shenina', 1]], 184, 22, 30],
      ['musafir', [['dolma', 1], ['quzi', 1]], 177, 13, 44],
      ['khalid', [['khalid_mix', 1]], 163, 21, 33],
      ['sham', [['falafel_plate', 1]], 151, 18, 25],
      ['khalid', [['liver_plate', 1], ['pepsi', 2]], 142, 22, 29],
      ['haj_kareem', [['rice_bamia', 1], ['arabic_salad', 1]], 133, 21, 38],
      ['musafir', [['kahi_geymar', 1]], 121, 9, 24],
      ['khalid', [['liver_plate', 1]], 112, 23, 52, true],
      ['sham', [['arabi_shawarma', 2]], 104, 21, 30],
      ['khalid', [['khalid_mix', 1]], 92, 14, 35],
      ['haj_kareem', [['rice_bamia', 1]], 85, 13, 37],
      ['khalid', [['liver_plate', 1], ['salad', 1]], 71, 22, 28],
      ['sham', [['arabi_shawarma', 1]], 64, 20, 26],
      ['musafir', [['dolma', 1]], 57, 13, 40],
      ['khalid', [['khalid_mix', 1], ['liver_plate', 1]], 43, 21, 32],
      ['sham', [['falafel_plate', 1], ['lemon_mint', 2]], 36, 17, 29],
      ['khalid', [['liver_plate', 1]], 29, 22, 58, true],
      ['haj_kareem', [['rice_bamia', 1], ['erbil_laban', 1]], 22, 21, 36],
      ['musafir', [['kahi_geymar', 2]], 15, 8, 23],
      ['khalid', [['liver_plate', 1], ['pepsi', 1]], 8, 22, 27],
      ['sham', [['arabi_shawarma', 1]], 4, 23, 25],
      ['khalid', [['liver_plate', 1]], 1, 21, 31],
    ];
    // [vehicle, daysAgo, hour, to work (else home), minutes the driver took to reach him]
    const RIDES = [
      ['tuktuk', 268, 7, true, 5], ['car', 247, 7, true, 7], ['tuktuk', 230, 15, false, 4], ['tuktuk', 211, 7, true, 6],
      ['car', 188, 20, false, 9], ['tuktuk', 169, 7, true, 4], ['tuktuk', 140, 7, true, 5], ['car', 118, 15, false, 6],
      ['tuktuk', 96, 7, true, 3], ['car', 74, 21, false, 8], ['tuktuk', 52, 7, true, 5], ['tuktuk', 33, 15, false, 4],
      ['car', 17, 7, true, 6], ['tuktuk', 6, 7, true, 4],
    ];
    // [Baghdad (else Kut), daysAgo, return leg, lap child]
    const SEATS = [[true, 238, false, false], [true, 160, true, false], [false, 97, false, false], [true, 40, false, true]];
    // What came off his bills: [daysAgo, memo, amount]; one late-delivery credit made good.
    const OFF_BILLS = [
      [270, 'deal:demo', 2_000], [244, 'promo:welcome', 3_000], [226, 'deal:demo', 1_500], [200, 'points:delivery_fee', 1_500],
      [180, 'deal:demo', 2_500], [159, 'return_bundle', 1_000], [138, 'points:service_fee', 1_000], [120, 'deal:demo', 2_000],
      [101, 'promo:ramadan', 2_500], [88, 'points:delivery_fee', 1_500], [70, 'deal:demo', 3_000], [55, 'deal:demo:delivery', 1_000],
      [41, 'points:delivery_fee', 2_000], [26, 'promo:friday', 1_500], [12, 'deal:demo', 2_500], [3, 'points:service_fee', 1_000],
    ];

    async function seatDone(personId, toBaghdad) {
      const driverId = await namedRajaaDriver(toBaghdad ? 'حيدر عباس' : 'جاسم محمد');
      const departAt = at5(Date.now() + 10 * MIN);
      const dep = await j7deps.announce(driverId, {
        garageId: 'mp_garage_bab1',
        corridorId: toBaghdad ? 'aziziyah_baghdad' : 'aziziyah_kut',
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 30 * MIN),
        vehicle: saloon('52318 واسط', 'سوناتا', 'فضية'),
        familyOnly: false,
      });
      const held = await j7deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: [toBaghdad ? 'front' : 'back_right'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
      const booked = await j7deps.book(personId, held.id, 'cash');
      await j7deps.selfie(driverId, dep.id, 'demo/selfie.jpg');
      for (const seatId of ['front', 'back_left', 'back_middle', 'back_right']) {
        await j7deps.markWalkUp(driverId, dep.id, { seatId, travellingAs: 'rijal' }).catch(() => null);
      }
      await j7deps.checkIn(driverId, dep.id, booked.pin);
      await j7deps.depart(driverId, dep.id);
      await j7deps.arrive(driverId, dep.id);
      return booked.id;
    }

    app.use('/demo/stats', async (req, res) => {
      try {
        const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
        if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/stats?personId=…' });
        const { home, work } = await homeAndWork(personId);
        for (const [key, lines, daysAgo, hour, doorMin, late] of MEALS) {
          const id = await deliveredOrder(personId, { key, lines, daysAgo: 0, pin: home.pin });
          const at = baghdadAt(daysAgo, hour, 10 + (daysAgo % 40));
          backdate(id, at, doorMin);
          const rec = orders.repo?.orders?.get?.(id);
          // On time unless marked late: the promise is ready + the locked ride.
          if (rec && rec.deliveredAt) {
            const ride = rec.promisedRideMin ?? 15;
            rec.promisedReadyAt = new Date(rec.deliveredAt.getTime() - ride * 60_000 + (late ? -12 : 6) * 60_000);
          }
        }
        const free = async (vehicle) => (await ensureDrivers()).find((d) => !d.tripId && d.def.vehicle === vehicle)?.def.name;
        for (const [vehicle, daysAgo, hour, toWork, waitMin] of RIDES) {
          const name = await free(vehicle);
          if (!name) throw new Error(`no free demo ${vehicle}`);
          const id = await finishedRide(personId, name, toWork ? home : work, toWork ? work : home, 5);
          const at = baghdadAt(daysAgo, hour, 15 + (daysAgo % 30));
          backdate(id, at, 14);
          const tripId = (await trips.tripIdsForOrder(id)).at(-1);
          const trip = tripId ? trips.repo?.trips?.get?.(tripId) : null;
          if (trip) {
            trip.acceptedAt = new Date(at.getTime() + 60_000);
            const pickup = [...trips.repo.stops.values()].find((s) => s.tripId === tripId && s.orderId === id && s.type === 'pickup');
            if (pickup) pickup.arrivedAt = new Date(at.getTime() + (1 + waitMin) * 60_000);
          }
        }
        for (const [toBaghdad, daysAgo, returnLeg, lapChild] of SEATS) {
          const bookingId = await seatDone(personId, toBaghdad);
          const b = j7deps.repo?.bookings?.get?.(bookingId);
          if (b) {
            b.completedAt = baghdadAt(daysAgo, toBaghdad ? 11 : 16);
            if (returnLeg) b.returnDiscountIqd = 1_000;
            if (lapChild) b.lapChildren = 1;
          }
        }
        const customer = StatsAccounts.customer(personId);
        const group = (id, kind, at, lines) => ({ id, kind, occurredAt: at, refs: {}, lines, controls: [] });
        const stamp = Date.now().toString(36);
        await statsLedger.recordAll([
          ...OFF_BILLS.map(([daysAgo, memo, amount], i) =>
            group(`demo:stats:${personId}:${stamp}:${i}`, 'money', baghdadAt(daysAgo, 21), [{ type: 'promo_funded', amount, fromAccount: StatsAccounts.platform, toAccount: customer, memo }]),
          ),
          group(`demo:stats:${personId}:${stamp}:late`, 'money', baghdadAt(29, 23), [{ type: 'credit_issued', amount: 1_500, fromAccount: StatsAccounts.platform, toAccount: customer, memo: 'late_promise' }]),
          // Points spent against fees: 100 points = 1,000 دينار.
          ...OFF_BILLS.filter(([, memo]) => memo.startsWith('points:')).map(([daysAgo, , amount], i) =>
            group(`demo:stats:${personId}:${stamp}:used${i}`, 'points', baghdadAt(daysAgo, 21), [{ type: 'points_redeemed', amount: amount / 10, fromAccount: StatsAccounts.points(personId), toAccount: StatsAccounts.pointsPool }]),
          ),
          ...[260, 200, 150, 95, 44, 8].map((daysAgo, i) =>
            group(`demo:stats:${personId}:${stamp}:pts${i}`, 'points', baghdadAt(daysAgo, 22), [{ type: 'points_earned', amount: 90 + i * 15, fromAccount: StatsAccounts.pointsPool, toAccount: StatsAccounts.points(personId) }]),
          ),
        ]);
        json(res, 200, { meals: MEALS.length, rides: RIDES.length, seats: SEATS.length });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });
  }

  // ───────────────────────── taxi ideas x2 / x3 / x4 (+ n10): taxis linked to a الرجعة seat ─────────────────────────
  //   POST /demo/rajaa-taxi?personId=…   → {outboundBookingId, lateOrderId, lateBookingId, returnBookingId, armedBookingId, placedBookingId,
  //                                          lateMin, driverTold, armed: {status, carEtaMin}, placed: {status, orderId, carEtaMin}, baghdadDepartureIds}
  // Home and الدائرة saved (when missing), then for that person:
  //   - x2: a booked seat on a car leaving the Gate 1 garage for Baghdad in about 95 minutes (the card offers
  //     a taxi timed to it);
  //   - x3: a seat on a car leaving the Gate 2 garage in 25 minutes and the taxi to it ordered now, taken by a
  //     driver who is still 12 km out — the late notice (the server's look) tells him and the الرجعة driver;
  //   - x4: three trips back from Kut, on the road: one far out (the card offers a waiting taxi), one far
  //     out and armed, and one 3 km from Aziziyah, armed and so already booked by the server.
  //   - n9 «Baghdad mode»: two fresh cars from the النهضة garage back to Aziziyah (in ~35 and ~95 minutes),
  //     so the card has a next car and one after whenever the shots run → `baghdadDepartureIds`.
  // With `&baghdadSeat=1` it does only this instead → `{baghdadBookingId}`: his booked seat on a new car back
  // from Baghdad in ~50 minutes (the card then shows the seat with the n10 switch).
  {
    const { GarageTaxiService } = await load('modules/garage-taxi/index.js');
    const { DeparturesService: GtDepartures } = await load('modules/routes/index.js');
    const { SavedPlacesService: GtPlaces } = await load('modules/places/index.js');
    const garageTaxi = app.get(GarageTaxiService);
    const gtDeps = app.get(GtDepartures);
    const gtPlaces = app.get(GtPlaces);
    const MIN = 60_000;
    const actor = (personId) => ({ personId, sessionId: 'demo' });
    const saloon = (plate, model, color) => ({ kind: 'saloon', layout: 4, plate, model, color });
    /** On the Kut road: ~35 km out, and ~3 km from the Aziziyah garages. */
    const FAR_ON_ROAD = { lat: 32.75, lng: 45.35 };
    const NEAR_ON_ROAD = { lat: 32.896, lng: 45.088 };
    /** Where the late taxi's driver still is (12 km north of town). */
    const FAR_DRIVER = { lat: 33.012, lng: 45.07 };
    let gtSeq = 0;
    const driverId = () => `drv_GTX${(++gtSeq).toString(36).toUpperCase()}`;

    /** His seat on that car: the first one free (the demo's other riders may have taken some). */
    async function holdFree(personId, departureId) {
      let last;
      for (const seatId of ['back_right', 'back_left', 'front', 'back_middle']) {
        try {
          return await gtDeps.hold(personId, { departureId, selection: { kind: 'seats', seatIds: [seatId] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
        } catch (err) {
          last = `${last ?? ''} | ${seatId}: ${err?.code ?? ''} ${err}`;
        }
      }
      throw new Error(`no free seat on ${departureId}:${last}`);
    }

    async function seatOut(personId, garageId, departAt) {
      const dep = await gtDeps.announce(driverId(), { garageId, corridorId: 'aziziyah_baghdad', departAt, latestDepartureAt: new Date(departAt.getTime() + 45 * MIN), vehicle: saloon('51234 واسط', 'كامري', 'بيضاء'), familyOnly: false });
      const held = await holdFree(personId, dep.id);
      return gtDeps.book(personId, held.id, 'cash');
    }

    /** A Kut → Aziziyah trip he is on (no demand posts there to claim the seats first), departed, the car's last fix at `at`. */
    async function tripBack(personId, at) {
      const drv = driverId();
      const departAt = new Date(Math.ceil((Date.now() + 10 * MIN) / MIN) * MIN);
      const dep = await gtDeps.announce(drv, { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', departAt, latestDepartureAt: new Date(departAt.getTime() + 30 * MIN), vehicle: saloon('77821 واسط', 'سوناتا', 'فضية'), familyOnly: false });
      const held = await holdFree(personId, dep.id);
      const booked = await gtDeps.book(personId, held.id, 'cash');
      await gtDeps.selfie(drv, dep.id, 'demo/selfie.jpg');
      // Full before its time (walk-ups in the other seats), and everyone on it checked in, so it can leave.
      for (const seatId of ['front', 'back_left', 'back_middle', 'back_right'].filter((x) => !held.seatIds.includes(x))) await gtDeps.markWalkUp(drv, dep.id, { seatId, travellingAs: 'rijal' });
      for (const b of await gtDeps.bookings(dep.id)) if (b.state === 'booked' && b.pin) await gtDeps.checkIn(drv, dep.id, b.pin, b.id);
      await gtDeps.depart(drv, dep.id);
      await gtDeps.driverPosition(drv, dep.id, at);
      return booked.id;
    }

    /** n9: a car from the النهضة garage back to Aziziyah in `inMin` minutes (a van: demand posts may claim some seats). */
    async function carFromBaghdad(inMin, plate) {
      const departAt = new Date(Math.ceil((Date.now() + inMin * MIN) / (5 * MIN)) * 5 * MIN);
      return gtDeps.announce(driverId(), { garageId: 'mp_garage_nahdha', corridorId: 'aziziyah_baghdad', departAt, latestDepartureAt: new Date(departAt.getTime() + 45 * MIN), vehicle: { kind: 'van', layout: 7, plate, model: 'ستاركس', color: 'بيضاء' }, familyOnly: false });
    }

    app.use('/demo/rajaa-taxi', async (req, res) => {
      try {
        const params = new URL(req.url ?? '/', 'http://x').searchParams;
        const personId = params.get('personId');
        if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa-taxi?personId=…' });
        if (params.get('baghdadSeat')) {
          const dep = await carFromBaghdad(50, '40712 بغداد');
          let held;
          for (const seatId of ['middle_right', 'middle_left', 'rear_right', 'rear_left', 'rear_middle', 'middle_middle', 'front']) {
            held = await gtDeps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: [seatId] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false }).catch(() => null);
            if (held) break;
          }
          if (!held) throw new Error(`no free seat on ${dep.id}`);
          const seat = await gtDeps.book(personId, held.id, 'cash');
          return json(res, 200, { baghdadBookingId: seat.id });
        }
        const mine = await gtPlaces.mine(personId);
        const home = mine.find((p) => p.label === 'home') ?? (await gtPlaces.save(personId, { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: HOME, photoIds: [], shareWithHousehold: false, clientRef: 'demo-gtaxi-home' }));
        if (!mine.some((p) => p.label === 'work')) await gtPlaces.save(personId, { cityId: 'aziziyah', label: 'work', name: 'الدائرة', pin: { lat: 32.9139, lng: 45.0603 }, photoIds: [], shareWithHousehold: false, clientRef: 'demo-gtaxi-work' });

        // x2: a seat out in ~95 minutes (on the 5-minute grid, like a garage sign).
        const outbound = await seatOut(personId, 'mp_garage_bab1', new Date(Math.ceil((Date.now() + 95 * MIN) / (5 * MIN)) * 5 * MIN));

        // x3: a car in 25 minutes, the taxi to it ordered now, taken by a driver still far away.
        const lateSeat = await seatOut(personId, 'mp_garage_bab2', new Date(Math.ceil((Date.now() + 25 * MIN) / MIN) * MIN));
        const plan = await garageTaxi.toGarage(actor(personId), { bookingId: lateSeat.id, from: { placeId: home.id } });
        if (plan.status !== 'offer' || plan.fareIqd === null) throw new Error(`no taxi offer for the late demo (${plan.unavailable})`);
        const booked = await garageTaxi.bookToGarage(actor(personId), { bookingId: lateSeat.id, from: { placeId: home.id }, fareIqd: plan.fareIqd, clientRequestId: `demo-gtaxi-${lateSeat.id}` });
        if (!booked.order) throw new Error(`taxi to the car not booked: ${JSON.stringify(booked)}`);
        const lateOrderId = booked.order.orderId;
        let trip = await trips.activeForOrder(lateOrderId);
        for (let i = 0; !trip && i < 30; i++) {
          await new Promise((r) => setTimeout(r, 100));
          trip = await trips.activeForOrder(lateOrderId);
        }
        if (!trip) throw new Error(`no trip for the taxi to the car: ${JSON.stringify(booked)}`);
        const d = (await ensureDrivers()).find((x) => !x.tripId && x.def.vehicle === 'car');
        if (!d) throw new Error('no free demo taxi');
        // The trip and its dispatch request come from the order.placed subscriber: give it a moment.
        let offerId = null;
        for (let i = 0; !offerId; i++) {
          try {
            ({ offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: d.id, reason: 'demo', force: true }));
          } catch (err) {
            if (i >= 30) throw err;
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        await acceptOffer(d, offerId);
        stopMover(trip.id);
        d.pos = { ...FAR_DRIVER };
        await trips.reportPosition(d.id, { tripId: trip.id, pin: FAR_DRIVER, at: new Date(), bearing: 180, speedKmh: 35 });
        await garageTaxi.tick();

        // x4: three trips back from Kut — offered, armed far out, armed close (booked at once).
        const returnBookingId = await tripBack(personId, FAR_ON_ROAD);
        const armedBookingId = await tripBack(personId, FAR_ON_ROAD);
        await garageTaxi.arm(actor(personId), { bookingId: armedBookingId, to: { placeId: home.id } });
        const placedBookingId = await tripBack(personId, NEAR_ON_ROAD);
        await garageTaxi.arm(actor(personId), { bookingId: placedBookingId, to: { placeId: home.id } });

        // n9: cars back from Baghdad today, whenever the shots run.
        const baghdadDepartureIds = [(await carFromBaghdad(35, '28145 بغداد')).id, (await carFromBaghdad(95, '61930 بغداد')).id];

        // What the server made of it (the late minutes it told, the armed taxi it booked), for a quick look.
        const late = await garageTaxi.forOrder(actor(personId), { orderId: lateOrderId });
        const placed = await garageTaxi.arrival(actor(personId), { bookingId: placedBookingId });
        const armed = await garageTaxi.arrival(actor(personId), { bookingId: armedBookingId });
        json(res, 200, { outboundBookingId: outbound.id, lateOrderId, lateBookingId: lateSeat.id, returnBookingId, armedBookingId, placedBookingId, lateMin: late?.lateMin ?? null, driverTold: late?.driverTold ?? false, armed: { status: armed.status, carEtaMin: armed.carEtaMin }, placed: { status: placed.status, orderId: placed.orderId, carEtaMin: placed.carEtaMin }, baghdadDepartureIds });
      } catch (err) {
        json(res, 500, { error: String(err?.stack ?? err) });
      }
    });
  }
}

// ───────────────────────── joy J7b: gifts and invitations ─────────────────────────
//
//   POST /demo/gift?personId=<id>     → {orderId}
// A «عزيمة» from that person to «أمي» (her own number) at مطعم خالد, paid from his wallet (25,000
// دينار is credited first) with the prices hidden; accepted and with a courier on the way to the
// kitchen, so the order screen says «عزيمة لـ أمي», the kitchen card shows «هدية» and the courier's
// drop-off says «هدية · لا تذكر السعر». (The heads-up card lives on the phone that placed it: place a
// gift through checkout to see it.)
//
//   POST /demo/invite?personId=<id>   → {code, friends}
// Two friends (زيد, حسن) accept that person's invite code, so «عزّم صديقك» reads «عزمت 2…».
{
  const { LedgerService, Accounts } = await load('modules/ledger/index.js');
  const { ReferralsService } = await load('modules/referrals/index.js');
  const ledger = app.get(LedgerService);
  const referrals = app.get(ReferralsService);
  const giftIdentity = app.get(IdentityService);
  let inviteSeq = 0;

  app.use('/demo/gift', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/gift?personId=…' });
      await ledger.record({ type: 'credit_issued', amount: 25_000, fromAccount: Accounts.bank, toAccount: Accounts.customer(personId), occurredAt: new Date(), idempotencyKey: `demo:gift-wallet:${personId}:${Date.now()}` });
      const placed = await orders.place(personId, {
        cityId: 'aziziyah',
        type: 'food',
        merchantOrgId: khalid.orgId,
        lines: [
          { catalogItemId: khalid.itemIds.get('liver_plate'), qty: 1 },
          { catalogItemId: khalid.itemIds.get('khalid_mix'), qty: 1 },
        ],
        participants: [{ ref: 'mum', role: 'recipient', label: 'أمي', phone: '07801112233' }],
        paymentMethod: 'wallet',
        gift: { hidePrices: true },
        dropoff: { zoneKey: 'zakur', pin: HOME },
      });
      await accept(placed.id);
      const courierId = await newCourier(kitchen);
      await assign(placed.id, courierId);
      json(res, 200, { orderId: placed.id, gift: placed.gift });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });

  app.use('/demo/invite', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/invite?personId=…' });
      const { code } = await referrals.mine({ personId, sessionId: 'demo' });
      const friends = [];
      // New friends per call: a friend accepts one invitation only.
      inviteSeq += 1;
      const base = 9_900_000 + inviteSeq * 10;
      for (const [phone, name] of [[`0781${base + 1}`, 'زيد'], [`0781${base + 2}`, 'حسن']]) {
        const id = await giftIdentity.ensurePersonByPhone(phone, personId, 'demo');
        await giftIdentity.updateProfile({ personId: id, sessionId: 'demo' }, { name });
        await referrals.claim({ personId: id, sessionId: 'demo' }, { code });
        friends.push(id);
      }
      json(res, 200, { code, friends });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── طرود (parcels, 2026-10-12) ─────────────────────────
//
//   POST /demo/parcels?personId=<id>   → {waiting: {parcelId, link}, onTheWay: {parcelId, orderId}, delivered: {parcelId, orderId}}
//
// Three parcels from the person's home (or the town centre) to «أم حيدر»: one waiting for her to mark her
// door (its link is printed to the log: open it to see the receiver's page), one a courier picked up and
// is bringing (the sender marked the door), and one delivered with the receipt code, with the pickup and
// door photos. The photos are read from DEMO_PARCEL_PHOTOS (default /mnt/project-files/parcels/photos)
// when that folder is there; otherwise the parcels have none.
{
  const { existsSync: parcelPhotosThere, readFileSync: readParcelPhoto } = await import('node:fs');
  const { ParcelsService } = await load('modules/parcels/index.js');
  const { SavedPlacesService: ParcelPlaces } = await load('modules/places/index.js');
  const parcels = app.get(ParcelsService);
  const parcelPlaces = app.get(ParcelPlaces);
  const photoDir = process.env.DEMO_PARCEL_PHOTOS ?? '/mnt/project-files/parcels/photos';
  const parcelPhoto = async (ownerId, file) => {
    const path = join(photoDir, file);
    if (!parcelPhotosThere(path)) return null;
    const bytes = readParcelPhoto(path);
    const store = app.get(PHOTO_STORE);
    const ticket = await store.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await store.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/jpeg', bytes });
    return ticket.uploadId;
  };
  const RECEIVER = { from: 'typed', name: 'أم حيدر', phone: '07703452210' };
  /** Near the big mosque in Zakur: where «أم حيدر» marked her door on the parcels already on their way. */
  const HER_DOOR = { lat: 32.8893, lng: 45.0731 };
  let parcelSeq = 0;
  const tripFor = async (orderId, from, to) => {
    for (let i = 0; i < 5; i++) {
      const trip = await trips.activeForOrder(orderId);
      if (trip) return trip;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Dispatch does not build parcel trips yet: the demo builds the courier trip itself (pickup → the door).
    const trip = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'parcel',
      orders: [{ orderId, minVehicleClass: null }],
      stops: [
        { orderId, type: 'pickup', zoneKey: from.zoneKey, target: from.pin },
        { orderId, type: 'dropoff', zoneKey: to.zoneKey, target: to.pin },
      ],
    });
    await dispatch.orchestrator.request({ tripId: trip.id, cityId: 'aziziyah', vertical: 'parcel', zoneId: from.zoneKey, pickup: from.pin, dropoffZoneId: to.zoneKey, minVehicleClass: null, cashIqd: 0 });
    return trip;
  };

  app.use('/demo/parcels', async (req, res) => {
    try {
      const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/parcels?personId=…' });
      const as = { personId, sessionId: 'demo' };
      if (!(await identity.me(as)).name) await identity.setName(as, 'علي');
      const home = (await parcelPlaces.mine(personId)).find((p) => p.label === 'home') ?? null;
      const pickup = home?.pin ? { zoneKey: home.zoneId, pin: home.pin } : { zoneKey: 'centre', pin: { lat: 32.9051, lng: 45.0607 } };
      const what = ['ملابس العيد', 'مفاتيح البيت', 'دوا لبيبي'];
      const send = async (n, door, extra = {}) => {
        parcelSeq += 1;
        const dropZoneKey = door.by === 'receiver' ? door.zoneKey : 'zakur';
        const { fareIqd } = await parcels.quote(as, { cityId: 'aziziyah', pickup, dropZoneKey, size: 'small' });
        const photoUploadId = await parcelPhoto(personId, 'received.jpg');
        return parcels.send(as, {
          cityId: 'aziziyah',
          clientRequestId: `demo-parcel-${parcelSeq}-${Date.now()}`,
          what: what[n],
          size: n === 1 ? 'small' : 'medium',
          declaredValueIqd: [40_000, 5_000, 15_000][n],
          ...(photoUploadId ? { photoUploadId } : {}),
          recipient: RECEIVER,
          pickup,
          door,
          payer: 'sender',
          fareIqd,
          ...extra,
        });
      };
      const carry = async (sent, { deliver }) => {
        const orderId = sent.orderId;
        const trip = await tripFor(orderId, pickup, { zoneKey: 'zakur', pin: HER_DOOR });
        const courierId = await newCourier(pickup.pin, { photo: true });
        await assign(orderId, courierId);
        const up = await stopOf(trip.id, 'pickup');
        await trips.reportPosition(courierId, { tripId: trip.id, pin: pickup.pin, at: new Date(), bearing: 160, speedKmh: 0 });
        await trips.arrive(trip.id, up.id, courierId, { pin: pickup.pin });
        const upPhoto = await parcelPhoto(courierId, 'trunk.jpg');
        await trips.completeStop(trip.id, up.id, courierId, upPhoto ? { handover: { photoUploadId: upPhoto } } : {});
        if (!deliver) {
          await startMover(trip.id, courierId, [pickup.pin, { lat: (pickup.pin.lat + HER_DOOR.lat) / 2, lng: (pickup.pin.lng + HER_DOOR.lng) / 2 }, HER_DOOR], 20);
          return { parcelId: sent.id, orderId };
        }
        const drop = await stopOf(trip.id, 'dropoff');
        await trips.reportPosition(courierId, { tripId: trip.id, pin: HER_DOOR, at: new Date(), bearing: 135, speedKmh: 0 });
        await trips.arrive(trip.id, drop.id, courierId, { pin: HER_DOOR });
        await parcels.checkPin({ personId: courierId, sessionId: 'demo' }, { orderId, pin: sent.pin });
        const dropPhoto = await parcelPhoto(courierId, 'door-handover.jpg');
        await trips.completeStop(trip.id, drop.id, courierId, { handover: { ...(dropPhoto ? { photoUploadId: dropPhoto } : {}) } });
        return { parcelId: sent.id, orderId };
      };
      const waiting = await send(0, { by: 'receiver', zoneKey: 'zakur' });
      const onTheWay = await carry(await send(1, { by: 'sender', dropoff: { zoneKey: 'zakur', pin: HER_DOOR } }), { deliver: false });
      const delivered = await carry(await send(2, { by: 'sender', dropoff: { zoneKey: 'zakur', pin: HER_DOOR } }), { deliver: true });
      console.log(`DEMO_API parcel waiting for the door: ${waiting.doorLink ?? '(no SHARE_LINK_BASE_URL)'}`);
      json(res, 200, { waiting: { parcelId: waiting.id, link: waiting.doorLink }, onTheWay, delivered });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// Food carts «عربانات» (2026-10-11): six Aziziyah carts (three open tonight around the souq garage,
// Street 30 and the centre; two closed until their hour; one away till Ramadan).
//   - POST /demo/carts?personId=…[&ticket=placed|ready]   follows كبدة أبو حيدر and عرانيس أبو سجاد;
//     with ticket, a walk-over ticket at the liver cart (ready = the cart said «جاهزة»)
//   - POST /demo/carts/open?key=corn|bagilla|zbeeb      the cart opens at its last spot (followers' «فتح» push)
//   - POST /demo/carts/close?key=liver|falafel|tea      the cart closes
{
  const { FoodCartsService, FOOD_CARTS_REPOSITORY, seedDemoCarts, DEMO_CARTS } = await load('modules/food-carts/index.js');
  const carts = app.get(FoodCartsService);
  const cartsRepo = app.get(FOOD_CARTS_REPOSITORY);
  // Carts are off at launch (`foodCarts.launched`); the demo opens them.
  app.get((await load('modules/config/index.js')).ConfigService).setFoodCartsOpen('aziziyah', true);
  const cartSeed = await seedDemoCarts(orgs, catalog, carts, { ownerId: 'demo-cart-owner' });
  const cartOf = (key) => cartSeed.find((c) => c.key === key);
  const cartActor = (personId) => ({ personId, sessionId: 'demo' });
  const ownerOps = {
    async open(key) {
      const c = cartOf(key);
      const d = DEMO_CARTS.find((x) => x.key === key);
      const rec = await cartsRepo.get(c.cartId);
      const spot = d.open ?? d.last ?? { lat: 32.905, lng: 45.06, label: 'ساحة المركز', facing: 180 };
      return carts.openAt(rec, spot, null, 'demo-cart-owner');
    },
    async close(key) {
      const c = cartOf(key);
      await cartsRepo.update(c.cartId, { closedAt: new Date(), closesAt: null });
      await orgs.setMerchantSettings(c.orgId, { closed: { reason: 'cart_closed', note: null, at: new Date() } });
    },
  };
  app.use('/demo/carts', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method !== 'POST') return json(res, 400, { error: 'POST /demo/carts?personId=…' });
      const key = url.searchParams.get('key');
      if (url.pathname === '/open' || url.pathname === '/close') {
        if (!key || !cartOf(key)) return json(res, 400, { error: `key=${cartSeed.map((c) => c.key).join('|')}` });
        await ownerOps[url.pathname.slice(1)](key);
        return json(res, 200, { ok: true, cartId: cartOf(key).cartId });
      }
      const personId = url.searchParams.get('personId');
      if (!personId) return json(res, 400, { error: 'POST /demo/carts?personId=…' });
      const a = cartActor(personId);
      await carts.follow(a, { cartId: cartOf('liver').cartId, on: true });
      await carts.follow(a, { cartId: cartOf('corn').cartId, on: true });
      const ticket = url.searchParams.get('ticket');
      let walkup = null;
      if (ticket === 'placed' || ticket === 'ready') {
        // A re-run starts clean: this person's open tickets are cancelled first (the 3-ticket limit).
        for (const w of await carts.myWalkups(a)) if (w.state === 'placed') await carts.cancelWalkup(a, { walkupId: w.id });
        for (const w of await carts.myWalkups(a)) if (w.state === 'ready') await cartsRepo.updateWalkup(w.id, ['ready'], { state: 'expired' });
        const liver = cartOf('liver');
        walkup = await carts.placeWalkup(a, { cartId: liver.cartId, lines: [{ itemId: `${liver.orgId}_laffa`, qty: 2 }, { itemId: `${liver.orgId}_maalak`, qty: 1 }] });
        if (ticket === 'ready') await cartsRepo.updateWalkup(walkup.id, ['placed'], { state: 'ready', readyAt: new Date() });
      }
      json(res, 200, { carts: cartSeed, walkupId: walkup?.id ?? null, code: walkup?.code ?? null });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

await app.listen(PORT);
console.log(`DEMO_API rajaa departures ${rajaa.departures.join(', ')}`);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (${seeded.map((s) => `${s.seed.key}=${s.orgId}`).join(', ')})`);
