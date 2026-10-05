// Demo API for driving the customer app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp.
//
//   PORT=3200 node apps/customer/scripts/demo-api.mjs
//
// Seeds the four launch restaurants (مطعم خالد، مشويات الحاج كريم، مأكولات الشام، مطعم المسافر) with
// their storefronts and menus — the same seed `pnpm db:seed` writes (@driver/contracts/seeds) — and
// plays the kitchen:
//   - an order a customer places is accepted after DEMO_KITCHEN_MS (default 20000; 0 = never);
//   - POST /demo/kitchen?orderId=<id>&action=accept|reject  decides one order now;
//   - POST /demo/active-order?personId=<id>  places and accepts a cash order from مطعم خالد for that
//     person, so home shows the pinned active-order pill with real API data;
//   - GET /demo/seed  lists the seeded restaurants with this process's org ids.
// It also seeds and drives the other M3 customer flows (each section below documents its hooks):
//   - POST /demo/track?personId=…&scenario=…, /demo/track/advance   live order screen (/order/[id])
//   - POST /demo/rajaa/claim|offers|topup?personId=…                 الرجعة boards (seeded at start)
//   - POST /demo/account?personId=…                                  places, wallet, household
//   - POST /demo/deals, /demo/topup/request|confirm, /demo/ops-agent      merchant deals at checkout, wallet top-up
//   - POST /demo/chat?personId=…&scenario=courier|merchant|ride, /demo/chat/clock   chat + share-trip
//   - POST /demo/ride[?acceptMs=…], /demo/ride/accept|advance?orderId=…   taxi/tuktuk drivers for booking
import { createRequire } from 'node:module';
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

const PORT = Number(process.env.PORT ?? 3200);
const KITCHEN_MS = Number(process.env.DEMO_KITCHEN_MS ?? 20_000);
const app = await createApp();

const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const orders = app.get(OrdersService);

const seeded = await seedStorefronts(orgs, catalog, undefined, 'demo-owner');
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
    const preparing = await accept(placed.id);
    json(res, 200, { orderId: preparing.id, state: preparing.state, totalIqd: preparing.totalIqd });
  } catch (err) {
    json(res, 500, { error: String(err?.stack ?? err) });
  }
});

app.use('/demo/seed', (_req, res) => json(res, 200, seeded.map((s) => ({ key: s.seed.key, orgId: s.orgId, name: s.seed.nameAr }))));

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
// Scenarios: preparing · on_the_way · unreachable · arrived · late · signal_lost · reassigning.
const { IdentityService } = await load('modules/identity/index.js');
const { DispatchService } = await load('modules/dispatch/index.js');
const { TripsService } = await load('modules/trips/index.js');
const { COURIER_VEHICLES } = await load('modules/tracking/index.js');
const identity = app.get(IdentityService);
const dispatch = app.get(DispatchService);
const trips = app.get(TripsService);
const vehicles = app.get(COURIER_VEHICLES);

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

async function newCourier(at) {
  courierSeq += 1;
  const phone = `07712${String(340000 + courierSeq).padStart(6, '0')}`;
  await identity.requestOtp({ phone, purpose: 'login' });
  const { code } = await identity.devLastOtp(phone);
  const courierId = (await identity.verifyOtp({ phone, code })).personId;
  await identity.grantRole({ personId: 'system:demo' }, { personId: courierId, kind: 'courier' });
  await identity.setName({ personId: courierId, sessionId: 'demo' }, NAMES[(courierSeq - 1) % NAMES.length]);
  vehicles.register?.(courierId, { vehicleClass: 'bike', plate: PLATES[(courierSeq - 1) % PLATES.length], label: null });
  await dispatch.presence.online(courierId, { cityId: 'aziziyah', at, vehicle: 'bike', tier: 'silver' });
  return courierId;
}

function stopMover(tripId) {
  clearInterval(movers.get(tripId));
  movers.delete(tripId);
}

/** Reports a fix every 2 s, `stepM` metres further along `path` (stops at the end). */
async function startMover(tripId, courierId, path, stepM = 38) {
  stopMover(tripId);
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

async function placeAccepted(personId, prepMinutes, dropoff = { zoneKey: 'zakur', pin: HOME }) {
  const placed = await orders.place(personId, {
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
  });
  await orders.merchantAccept('demo-staff', { orderId: placed.id, prepMinutes });
  await orders.markPreparing('demo-staff', { orderId: placed.id });
  return placed.id;
}

/** Dispatcher hands the trip to the courier; he accepts through dispatch (the real path). */
async function assign(orderId, courierId) {
  const trip = await trips.activeForOrder(orderId);
  if (!trip) throw new Error(`no trip for ${orderId}`);
  const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: courierId, reason: 'demo' });
  await dispatch.respond({ personId: courierId, sessionId: 'demo' }, { offerId, accept: true });
  return trip.id;
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
    await trips.completeStop(tripId, drop.id, courierId, { handover: { cashCollectedIqd: order.totalIqd } });
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

async function scenario(personId, name) {
  const late = name === 'late';
  // "arrived" goes to the person's own home when it has a gate photo, so the arrival shows that door.
  const home = name === 'arrived' ? await savedHome(personId) : null;
  const orderId = await placeAccepted(personId, late ? 1 : 20, home ? { zoneKey: home.zoneId, pin: home.pin } : undefined);
  const start = late ? FAR_TO_KITCHEN[0] : TO_KITCHEN[0];
  const courierId = await newCourier(start);
  const tripId = await assign(orderId, courierId);
  const d = { tripId, courierId, step: late ? 'late' : 'preparing', door: home?.pin ?? null };
  demos.set(orderId, d);
  if (name === 'preparing' || late) {
    await startMover(tripId, courierId, late ? FAR_TO_KITCHEN : TO_KITCHEN, late ? 22 : 30);
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
  await advance(orderId); // at the door
  if (name === 'unreachable') {
    const drop = await stopOf(tripId, 'dropoff');
    await trips.startUnreachable(tripId, drop.id, courierId);
    d.step = 'unreachable';
    return { orderId, tripId, courierId };
  }
  await advance(orderId); // delivered
  return { orderId, tripId, courierId };
}

const SCENARIOS = new Set(['preparing', 'on_the_way', 'unreachable', 'arrived', 'late', 'signal_lost', 'reassigning']);

app.use('/demo/track', async (req, res) => {
  try {
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('{"error":"POST"}');
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
    res.end(JSON.stringify({ scenario: name, ...(await scenario(personId, name)) }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err?.stack ?? err) }));
  }
});

// ───────────────────────── الرجعة (intercity) demo ─────────────────────────
// Departures on both sides of both corridors (one nearly full with the front taken and a back
// middle seat that a woman can't take between two men, a van with a walk-up, a family-only SUV,
// a car with its front seat sold), demand posts behind the board banner, and three dev hooks:
//   POST /demo/rajaa/claim?personId=…    announce a car inside that person's open أريد أرجع window
//   POST /demo/rajaa/offers?personId=…   three drivers offer on that person's open requests
//   POST /demo/rajaa/topup?personId=…&amount=…   credit the wallet (request-board deposit)
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
  const d1 = await announce('drv_7K2Q', { garageId: 'mp_garage_nahdha', inMin: 20, latestMin: 40, vehicle: saloon('12345 بغداد', 'كامري', 'بيضاء') });
  await seat(d1, ['front'], 'rijal');
  await seat(d1, ['back_left'], 'rijal');
  await seat(d1, ['back_right'], 'rijal');
  const d2 = await announce('drv_4M9T', { garageId: 'mp_garage_nahdha', inMin: 50, latestMin: 60, vehicle: { kind: 'van', layout: 7, plate: '45678 بغداد', model: 'جي إم سي', color: 'رصاصي' } });
  await seat(d2, ['middle_left', 'middle_middle'], 'nisa');
  await seat(d2, ['rear_left'], 'rijal');
  await deps.markWalkUp('drv_4M9T', d2.id, { seatId: 'rear_right', travellingAs: 'rijal' });
  await deps.selfie('drv_4M9T', d2.id, 'demo/selfie.jpg');
  const d3 = await announce('drv_9B3H', { garageId: 'mp_garage_nahdha', inMin: 80, vehicle: { kind: 'suv', layout: 6, plate: '30211 بغداد', model: 'تاهو', color: 'سوداء' }, familyOnly: true });
  await seat(d3, ['middle_left', 'middle_right'], 'aila');
  const d4 = await announce('drv_2X8P', { garageId: 'mp_garage_nahdha', inMin: 130, vehicle: saloon('77821 بغداد', 'سوناتا', 'فضية') });
  await seat(d4, ['front'], 'rijal');
  // The nearly-full car is past T−30: give it a live position ~1.3 km from the garage.
  const carFrom = { lat: 33.3262, lng: 44.4262 };
  const nahdha = { lat: 33.3344, lng: 44.4165 };
  await deps.driverPosition('drv_7K2Q', d1.id, carFrom);
  let step = 0;
  globalThis.setInterval(() => {
    // Creep toward the garage every 10 s (stops short of the 150 m geofence).
    const f = Math.min(++step, 100) / 120;
    void deps
      .driverPosition('drv_7K2Q', d1.id, { lat: carFrom.lat + (nahdha.lat - carFrom.lat) * f, lng: carFrom.lng + (nahdha.lng - carFrom.lng) * f })
      .catch(() => {});
  }, 10_000).unref();

  // Aziziyah side — the three gates → بغداد (السوق left empty on purpose).
  const a1 = await announce('drv_5R1D', { garageId: 'mp_garage_bab1', inMin: 45, vehicle: saloon('51234 واسط', 'كامري', 'بيضاء') });
  await seat(a1, ['back_left'], 'nisa');
  await seat(a1, ['back_middle'], 'nisa');
  await seat(a1, ['front'], 'rijal');
  const a2 = await announce('drv_8T6W', { garageId: 'mp_garage_bab2', inMin: 95, vehicle: { kind: 'van', layout: 7, plate: '62210 واسط', model: 'ستاركس', color: 'بيضاء' } });
  await seat(a2, ['rear_left'], 'rijal');

  // Kut corridor, both ways.
  const k1 = await announce('drv_3C5N', { garageId: 'mp_garage_bab1', corridorId: 'aziziyah_kut', inMin: 40, vehicle: saloon('48810 واسط', 'أفانتي', 'سماوي') });
  await seat(k1, ['front'], 'rijal');
  await seat(k1, ['back_left', 'back_middle'], 'aila');
  const k2 = await announce('drv_6J2L', { garageId: 'mp_garage_kut', corridorId: 'aziziyah_kut', inMin: 100, vehicle: saloon('39921 واسط', 'إلنترا', 'حمراء') });
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
      const dep = await deps.announce('drv_1Q7Z', {
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

  app.use('/demo/rajaa/offers', async (req, res) => {
    try {
      const personId = personOf(req);
      const open = (await requests.mine(personId ?? '')).filter((r) => r.state === 'open');
      if (req.method !== 'POST' || open.length === 0) return json(res, 400, { error: 'POST with a personId that has an open request' });
      for (const r of open) {
        await requests.offer('drv_5R1D', r.id, 45_000);
        await requests.offer('drv_8T6W', r.id, 50_000);
        await requests.offer('drv_3C5N', r.id, 60_000);
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
// pending under their number), and a household where Minar (25,000 limit) waits for approval of a
// 32,000 order and shares her family home.
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
      await orgs.requestPayerApproval({ orgId: household.id, orderId: `demo-order-${now}`, requestedBy: minar, amountIqd: 32_000 });
      if (!(await places.mine(minar)).some((p) => p.access === 'owner')) {
        await places.save(minar, { cityId: 'aziziyah', label: 'custom', name: 'بيت أهل منار', pin: { lat: 32.887, lng: 45.0765 }, note: 'البيت الثالث بعد الفرن', photoIds: [], shareWithHousehold: true });
      }
      await ledger.recordAll(group(`demo:hh:${household.id}`, 'money', ago(30), [{ type: 'credit_issued', amount: 60_000, fromAccount: Accounts.bank, toAccount: Accounts.household(household.id), memo: 'topup:agent' }]));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ householdId: household.id, homeId: home.id }));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack ?? err));
    }
  });
}

// ───────────────────────── merchant deals at checkout + wallet top-up ─────────────────────────
//
//   POST /demo/deals                                 two approved, running deals on مطعم خالد (idempotent):
//                                                    "خصم 20% على كل المنيو" and "توصيل مجاني فوق 15,000 دينار";
//                                                    also keeps the kitchen open around the clock for screenshots
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
      json(res, 200, (await promotions.list(khalid.orgId)).map((d) => ({ dealId: d.dealId, state: d.state, type: d.type })));
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
//   POST /demo/chat?personId=<id>&scenario=courier|merchant|ride   → {orderId, …}
//   POST /demo/chat/clock?minutes=<n>                               → shifts the chat module's clock
//
// `courier`: an order on the way (the track demo's courier) with a conversation already going —
// a quick reply, the customer's gate note, a number the courier typed (masked by the server), a
// location pin, one unread. `merchant`: the same with the kitchen (a staff member of مطعم خالد)
// asking about a swapped item. `ride`: a taxi ride with a moving car, a share-trip link already
// made → {token, path}. `/demo/chat/clock?minutes=31` lets a screenshot show a closed thread
// (minutes=0 resets); it only moves the chat module's clock.
{
  const { ChatService } = await load('modules/chat/index.js');
  const { ShareLinksService } = await load('modules/tracking/index.js');
  const chat = app.get(ChatService);
  const shareLinks = app.get(ShareLinksService);
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

  async function driverWithCar(at) {
    courierSeq += 1;
    const phone = `07713${String(450000 + courierSeq).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const driverId = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: driverId, kind: 'driver' });
    await identity.setName({ personId: driverId, sessionId: 'demo' }, 'مصطفى جاسم');
    vehicles.register?.(driverId, { vehicleClass: 'car', plate: 'واسط 31207', label: 'تويوتا كورولا · أبيض' });
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
      const link = await shareLinks.createShareLink(as(personId), { orderId: ride.id });
      return { orderId: ride.id, tripId: trip.id, driverId, token: link.token, path: link.path };
    }
    const { orderId, tripId, courierId } = await scenario(personId, 'on_the_way');
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
      if (!personId || !['courier', 'merchant', 'ride'].includes(name)) return json(res, 400, { error: 'POST /demo/chat?personId=…&scenario=courier|merchant|ride' });
      json(res, 200, { scenario: name, ...(await chatScenario(personId, name)) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

// ───────────────────────── city taxi / tuktuk demo ─────────────────────────
// Booking happens in the app (orders.place type ride → the API builds the trip and broadcasts it).
// This section only plays the drivers:
//   POST /demo/ride[?acceptMs=3000]   two taxis and two tuktuks online around the centre (idempotent);
//                                     the nearest one offered a ride accepts after acceptMs
//                                     (DEMO_RIDE_ACCEPT_MS, default 3000; 0 = hold every offer)
//   POST /demo/ride/accept?orderId=…  accept that ride's open offer now
//   POST /demo/ride/advance?orderId=… one step: to pickup → at pickup → on the trip → arrived (cash paid)
{
  const RIDE_DRIVERS = [
    { name: 'حسين علي', vehicle: 'car', plate: 'واسط 27415', label: 'كيا سيراتو · فضي', at: { lat: 32.9068, lng: 45.0591 } },
    { name: 'مصطفى جاسم', vehicle: 'car', plate: 'واسط 31207', label: 'تويوتا كورولا · أبيض', at: { lat: 32.9031, lng: 45.0667 } },
    { name: 'عباس كريم', vehicle: 'tuktuk', plate: 'واسط 8841', label: 'باجاج · أحمر', at: { lat: 32.9112, lng: 45.0618 } },
    { name: 'سجاد فاضل', vehicle: 'tuktuk', plate: 'واسط 9206', label: 'باجاج · أزرق', at: { lat: 32.9019, lng: 45.0579 } },
  ];
  const drivers = []; // { id, def, pos, tripId }
  const rides = new Map(); // orderId → { tripId, driverId, step }
  let acceptMs = Number(process.env.DEMO_RIDE_ACCEPT_MS ?? 3000);
  const seen = new Map(); // offerId → first seen (ms)

  async function rideDriver(def, i) {
    const phone = `07714${String(560000 + i).padStart(6, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code })).personId;
    await identity.grantRole({ personId: 'system:demo' }, { personId: id, kind: 'driver' });
    await identity.setName({ personId: id, sessionId: 'demo' }, def.name);
    vehicles.register?.(id, { vehicleClass: def.vehicle, plate: def.plate, label: def.label });
    await dispatch.presence.online(id, { cityId: 'aziziyah', at: def.at, vehicle: def.vehicle, tier: 'gold' });
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
        await dispatch.presence.heartbeat(d.id, d.pos).catch(() => undefined);
        const open = await dispatch.openOffer(d.id, 'aziziyah');
        if (!open) continue;
        const first = seen.get(open.offer.id) ?? Date.now();
        seen.set(open.offer.id, first);
        if (acceptMs > 0 && Date.now() - first >= acceptMs) await acceptOffer(d, open.offer.id);
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
      await trips.completeStop(r.tripId, pickup.id, r.driverId);
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
      if (url.pathname.endsWith('/accept')) {
        const trip = await trips.activeForOrder(orderId);
        if (!trip) return json(res, 404, { error: 'no trip' });
        for (const d of await ensureDrivers()) {
          const open = await dispatch.openOffer(d.id, 'aziziyah');
          if (open && open.request.tripId === trip.id) return json(res, 200, { orderId: await acceptOffer(d, open.offer.id) });
        }
        return json(res, 409, { error: 'no open offer for that ride yet' });
      }
      if (url.searchParams.has('acceptMs')) acceptMs = Number(url.searchParams.get('acceptMs'));
      const list = await ensureDrivers();
      json(res, 200, { acceptMs, drivers: list.map((d) => ({ id: d.id, name: d.def.name, vehicle: d.def.vehicle, busy: Boolean(d.tripId) })) });
    } catch (err) {
      json(res, 500, { error: String(err?.stack ?? err) });
    }
  });
}

await app.listen(PORT);
console.log(`DEMO_API rajaa departures ${rajaa.departures.join(', ')}`);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (${seeded.map((s) => `${s.seed.key}=${s.orgId}`).join(', ')})`);
