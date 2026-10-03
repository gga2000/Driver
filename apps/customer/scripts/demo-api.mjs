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

await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (restaurant ${rest.id})`);
