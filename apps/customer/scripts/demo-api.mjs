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

await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (${seeded.map((s) => `${s.seed.key}=${s.orgId}`).join(', ')})`);
