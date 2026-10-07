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
//   - POST /demo/kitchen?orderId=<id>&action=accept|reject  decides one order now;
//   - POST /demo/active-order?personId=<id>[&accept=0]  places and accepts (or not) a cash order from مطعم خالد for that
//     person, so home shows the pinned active-order pill with real API data;
//   - GET /demo/seed  lists the seeded restaurants with this process's org ids;
//   - POST /demo/popular  24 town orders at مطعم خالد so «الأكثر طلباً بالعزيزية» shows (joy o8);
//   - POST /demo/quiet?on=1|0  turns a quiet day (Console mourning day) on or off for today.
//   - POST /demo/season?kind=ramadan|eid|off  a Ramadan or Eid period from today (J6 home card, checkout iftar slot).
// It also seeds and drives the other M3 customer flows (each section below documents its hooks):
//   - POST /demo/track?personId=…&scenario=…, /demo/track/advance   live order screen (/order/[id])
//   - POST /demo/history?personId=…                                 طلباتي: three past delivered orders
//   - POST /demo/usuals?personId=…, /demo/pot?key=…&item=…             joy J7a: usuals, «غدا الجمعة», «قدر اليوم» (pots + stories seeded)
//   - POST /demo/rajaa/claim|offers|topup?personId=…                 الرجعة boards (seeded at start)
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
const KITCHEN_MS = Number(process.env.DEMO_KITCHEN_MS ?? 20_000);
const app = await createApp();

const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const orders = app.get(OrdersService);
const controls = app.get(ControlsService);

// The four launch kitchens, then the demo-only café, juice bar, sweets and ice cream shops so every food
// door has shops behind it (@driver/contracts/demo-shops; never in `pnpm db:seed`).
const { DEMO_SHOPS } = await import(pathToFileURL(fileURLToPath(new URL('../../../packages/contracts/dist/seeds/demo-shops.js', import.meta.url))).href);
const seeded = [...(await seedStorefronts(orgs, catalog, undefined, 'demo-owner')), ...(await seedStorefronts(orgs, catalog, DEMO_SHOPS, 'demo-owner'))];
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
    if (req.method !== 'POST' || !orderId || !['accept', 'reject'].includes(action ?? '')) return json(res, 400, { error: 'POST /demo/kitchen?orderId=…&action=accept|reject' });
    const order = action === 'accept' ? await accept(orderId) : await orders.merchantReject('demo-staff', { orderId, reason: 'المطبخ مزدحم' });
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
// `&rated=1` on any scenario gives its courier six rated past deliveries (the card's ★ rating).
// `late&pastPromiseMin=<n>` moves the promise <n> minutes into the past (the late banner's promise bar);
// `late_apology` puts it past the apology step (MoneyRules.latePromise.apologyAfterMin), so the order's next
// read (or the sweep) sends the one "آسفين، طلبك تأخر شوية" push and the banner says sorry;
// `late_credit` puts it past the honest-delay threshold, so the order's next read posts the credit.
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

async function placeAccepted(personId, prepMinutes, dropoff = { zoneKey: 'zakur', pin: HOME }, tender = null, { cooking = true } = {}) {
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
  };
  let statedTenderIqd;
  if (tender) {
    const { totalIqd } = await orders.quote(personId, input);
    statedTenderIqd = tender >= totalIqd ? tender : tenderOptions(totalIqd)[1];
  }
  const placed = await orders.place(personId, { ...input, ...(statedTenderIqd ? { statedTenderIqd } : {}) });
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
  if (name === 'late_credit' || name === 'late_apology') {
    // Past one of the honest-delay promise's steps (MoneyRules.latePromise): the next read sends the
    // apology (+ apologyAfterMin) or posts the credit (+ afterMin; the apology went out on the way).
    const { AZIZIYAH_MONEY_RULES } = await import('@driver/contracts');
    const r = await scenario(personId, 'late');
    const rules = AZIZIYAH_MONEY_RULES.latePromise;
    await pastPromise(personId, r.orderId, (name === 'late_credit' ? rules.afterMin : rules.apologyAfterMin) + 1);
    return r;
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
  const orderId = await placeAccepted(personId, late ? 1 : 20, home ? { zoneKey: home.zoneId, pin: home.pin } : undefined, opts.tender ?? null);
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

const SCENARIOS = new Set(['kitchen', 'preparing', 'on_the_way', 'near', 'at_door', 'unreachable', 'arrived', 'late', 'late_apology', 'late_credit', 'signal_lost', 'reassigning']);

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
    res.end(JSON.stringify({ scenario: name, ...(await scenario(personId, name, { tender, noChange, pastPromiseMin, rated })) }));
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
    dropoff: { zoneKey: 'zakur', pin: HOME },
  });
  await accept(placed.id);
  const courierId = await newCourier(r.seed.pin);
  const tripId = await assign(placed.id, courierId);
  await orders.markReady('demo-staff', { orderId: placed.id });
  const pickup = await stopOf(tripId, 'pickup');
  await trips.arrive(tripId, pickup.id, courierId, { pin: r.seed.pin });
  await trips.completeStop(tripId, pickup.id, courierId);
  const drop = await stopOf(tripId, 'dropoff');
  await trips.arrive(tripId, drop.id, courierId, { pin: HOME });
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
//   POST /demo/rajaa/offers?personId=…   three drivers offer on that person's open requests
//   POST /demo/rajaa/topup?personId=…&amount=…   credit the wallet (request-board deposit)
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
  const saloon = (plate, model, color) => ({ kind: 'saloon', layout: 4, plate, model, color });

  // Baghdad side — كراج النهضة → العزيزية.
  const d1 = await announce(D.drv_7K2Q, { garageId: 'mp_garage_nahdha', inMin: 20, latestMin: 40, vehicle: saloon('12345 بغداد', 'كامري', 'بيضاء') });
  await seat(d1, ['front'], 'rijal');
  await seat(d1, ['back_left'], 'rijal');
  await seat(d1, ['back_right'], 'rijal');
  const d2 = await announce(D.drv_4M9T, { garageId: 'mp_garage_nahdha', inMin: 50, latestMin: 60, vehicle: { kind: 'van', layout: 7, plate: '45678 بغداد', model: 'جي إم سي', color: 'رصاصي' } });
  await seat(d2, ['middle_left', 'middle_middle'], 'nisa');
  await seat(d2, ['rear_left'], 'rijal');
  await deps.markWalkUp(D.drv_4M9T, d2.id, { seatId: 'rear_right', travellingAs: 'rijal' });
  await deps.selfie(D.drv_4M9T, d2.id, 'demo/selfie.jpg');
  const d3 = await announce(D.drv_9B3H, { garageId: 'mp_garage_nahdha', inMin: 80, vehicle: { kind: 'suv', layout: 6, plate: '30211 بغداد', model: 'تاهو', color: 'سوداء' }, familyOnly: true });
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
  const a1 = await announce(D.drv_5R1D, { garageId: 'mp_garage_bab1', inMin: 45, vehicle: saloon('51234 واسط', 'كامري', 'بيضاء') });
  await seat(a1, ['back_left'], 'nisa');
  await seat(a1, ['back_middle'], 'nisa');
  await seat(a1, ['front'], 'rijal');
  const a2 = await announce(D.drv_8T6W, { garageId: 'mp_garage_bab2', inMin: 95, vehicle: { kind: 'van', layout: 7, plate: '62210 واسط', model: 'ستاركس', color: 'بيضاء' } });
  await seat(a2, ['rear_left'], 'rijal');

  // Kut corridor, both ways.
  const k1 = await announce(D.drv_3C5N, { garageId: 'mp_garage_bab1', corridorId: 'aziziyah_kut', inMin: 40, vehicle: saloon('48810 واسط', 'أفانتي', 'سماوي') });
  await seat(k1, ['front'], 'rijal');
  await seat(k1, ['back_left', 'back_middle'], 'aila');
  const k2 = await announce(D.drv_6J2L, { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', inMin: 100, vehicle: saloon('39921 واسط', 'إلنترا', 'حمراء') });
  await seat(k2, ['back_right'], 'nisa');

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

  // POST /demo/rajaa/onboard?personId=… — this person is in the car: a seat on a car leaving bab 1
  // in 10 minutes, booked (cash) and checked in with the PIN. Their boarding pass then carries طوارئ.
  let onboardSeq = 0;
  app.use('/demo/rajaa/onboard', async (req, res) => {
    try {
      const personId = personOf(req);
      if (req.method !== 'POST' || !personId) return json(res, 400, { error: 'POST /demo/rajaa/onboard?personId=…' });
      const departAt = new Date(Math.ceil((Date.now() + 10 * MIN) / MIN) * MIN);
      // A fresh driver each call (a driver cannot announce two overlapping departures).
      const driverId = `drv_S0S${(++onboardSeq).toString(36).toUpperCase()}`;
      const dep = await deps.announce(driverId, {
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt,
        latestDepartureAt: new Date(departAt.getTime() + 30 * MIN),
        vehicle: saloon('58120 واسط', 'كامري', 'بيضاء'),
        familyOnly: false,
      });
      const held = await deps.hold(personId, { departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_right'] }, travellingAs: 'rijal', pickup: { kind: 'garage' }, largeBags: false });
      const booked = await deps.book(personId, held.id, 'cash');
      await deps.checkIn(driverId, dep.id, booked.pin);
      json(res, 200, { departureId: dep.id, bookingId: booked.id });
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

  app.use('/demo/rajaa/offers', async (req, res) => {
    try {
      const personId = personOf(req);
      const open = (await requests.mine(personId ?? '')).filter((r) => r.state === 'open');
      if (req.method !== 'POST' || open.length === 0) return json(res, 400, { error: 'POST with a personId that has an open request' });
      for (const r of open) {
        await requests.offer(D.drv_5R1D, r.id, 45_000);
        await requests.offer(D.drv_8T6W, r.id, 50_000);
        await requests.offer(D.drv_3C5N, r.id, 60_000);
      }
      json(res, 200, { requests: open.map((r) => r.id) });
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
      await trips.completeStop(trip.id, pickup.id, driverId);
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
    const saloon = (plate, model, color) => ({ kind: 'saloon', layout: 4, plate, model, color });
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

await app.listen(PORT);
console.log(`DEMO_API rajaa departures ${rajaa.departures.join(', ')}`);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (${seeded.map((s) => `${s.seed.key}=${s.orgId}`).join(', ')})`);
