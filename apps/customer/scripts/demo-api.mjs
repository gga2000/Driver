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
// Seeds one restaurant ("مطعم خالد", centre) with a small menu, and exposes a dev-only hook
//   POST /demo/active-order?personId=<id>
// that places a cash food order for that person and has the kitchen accept it, so home shows the
// pinned active-order pill with real API data. `POST /demo/track` (below) drives the live order
// screen: a dispatched courier moving through Aziziyah, the unreachable timer, the arrival.
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
const kitchen = { lat: 32.9095, lng: 45.0635 };
const rest = orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'demo-owner' });
orgs.setMerchantSettings(rest.id, { commissionTier: 'base', location: { zoneKey: 'street_30', pin: kitchen } });
await orgs.settled?.();
const khalid = seeded.find((s) => s.seed.key === 'khalid');

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

async function placeAccepted(personId, prepMinutes) {
  const placed = await orders.place(personId, {
    cityId: 'aziziyah',
    type: 'food',
    merchantOrgId: rest.id,
    lines: [
      { catalogItemId: kas.id, qty: 2 },
      { catalogItemId: tikka.id, qty: 1 },
    ],
    paymentMethod: 'cash',
    dropoff: { zoneKey: 'zakur', pin: HOME },
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
    await trips.reportPosition(courierId, { tripId, pin: HOME, at: new Date(), bearing: 135, speedKmh: 0 });
    await trips.arrive(tripId, drop.id, courierId, { pin: HOME });
    d.step = 'at_door';
  } else if (d.step === 'at_door' || d.step === 'unreachable') {
    const drop = await stopOf(tripId, 'dropoff');
    const order = await orders.get(orderId);
    await trips.completeStop(tripId, drop.id, courierId, { handover: { cashCollectedIqd: order.totalIqd } });
    d.step = 'arrived';
  }
  return d.step;
}

async function scenario(personId, name) {
  const late = name === 'late';
  const orderId = await placeAccepted(personId, late ? 1 : 20);
  const start = late ? FAR_TO_KITCHEN[0] : TO_KITCHEN[0];
  const courierId = await newCourier(start);
  const tripId = await assign(orderId, courierId);
  const d = { tripId, courierId, step: late ? 'late' : 'preparing' };
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

await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (${seeded.map((s) => `${s.seed.key}=${s.orgId}`).join(', ')})`);
