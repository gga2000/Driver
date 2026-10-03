// Demo API for driving the customer app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp.
//
//   PORT=3200 node apps/customer/scripts/demo-api.mjs
//
// Seeds one restaurant ("مطعم خالد", centre) with a small menu, and exposes a dev-only hook
//   POST /demo/active-order?personId=<id>
// that places a cash food order for that person and has the kitchen accept it, so home shows the
// pinned active-order pill with real API data.
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
const { CatalogService } = await load('modules/catalog/index.js');

const PORT = Number(process.env.PORT ?? 3200);
const app = await createApp();

const orgs = app.get(OrgsService);
const catalog = app.get(CatalogService);
const orders = app.get(OrdersService);

const kitchen = { lat: 32.9095, lng: 45.0635 };
const rest = orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'demo-owner' });
orgs.setMerchantSettings(rest.id, { commissionTier: 'standard', location: { zoneKey: 'street_30', pin: kitchen } });
await orgs.settled?.();
const kas = await catalog.addItem({ orgId: rest.id, nameAr: 'لفة كص', priceIqd: 4000 });
const tikka = await catalog.addItem({ orgId: rest.id, nameAr: 'تكة لحم', priceIqd: 6000 });

app.use('/demo/active-order', async (req, res) => {
  try {
    const personId = new URL(req.url ?? '/', 'http://x').searchParams.get('personId');
    if (req.method !== 'POST' || !personId) {
      res.statusCode = 400;
      res.end('POST /demo/active-order?personId=…');
      return;
    }
    const placed = await orders.place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: rest.id,
      lines: [
        { catalogItemId: kas.id, qty: 2 },
        { catalogItemId: tikka.id, qty: 1 },
      ],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
    });
    const accepted = await orders.merchantAccept('demo-staff', { orderId: placed.id, prepMinutes: 20 });
    const preparing = await orders.markPreparing('demo-staff', { orderId: accepted.id });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ orderId: preparing.id, state: preparing.state, totalIqd: preparing.totalIqd }));
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err?.stack ?? err));
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

await app.listen(PORT);
console.log(`DEMO_API rajaa departures ${rajaa.departures.join(', ')}`);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (restaurant ${rest.id})`);
