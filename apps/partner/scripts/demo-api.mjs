// Demo API for driving the Partner app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp. Port 3301 by default (the customer demo uses 3200).
//
//   node apps/partner/scripts/demo-api.mjs            # PORT=3301
//
// This file only boots the API and builds a shared `demo` toolkit; the seed data and the /demo/*
// hooks live in sections under scripts/demo/*.mjs, loaded in file-name order. Each section is
//
//   export default async function register(demo) { …seed…; demo.route('/demo/thing', handler) }
//
// so a new flow adds a file instead of editing this one. See README "Adding a flow".
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);

const PORT = Number(process.env.PORT ?? 3301);
const { createApp } = await load('bootstrap.js');
const app = await createApp();
// /demo/* hooks hang off one router mounted before init (Express routes added after Nest's init
// would sit behind its 404). Module init registers the event subscribers (dispatch builds courier
// trips on order.accepted); sections seed through them, so init runs before they do.
const demoRouter = requireFromApi('express').Router();
app.use('/demo', demoRouter);
await app.init();

const { IdentityService } = await load('modules/identity/index.js');
const { DispatchService } = await load('modules/dispatch/index.js');
const { TripsService } = await load('modules/trips/index.js');
const { OrdersService } = await load('modules/orders/index.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService, seedStorefronts } = await load('modules/catalog/index.js');
const { Accounts, LedgerService } = await load('modules/ledger/index.js');
const { COURIER_VEHICLES } = await load('modules/tracking/index.js');

const services = {
  identity: app.get(IdentityService),
  dispatch: app.get(DispatchService),
  trips: app.get(TripsService),
  orders: app.get(OrdersService),
  orgs: app.get(OrgsService),
  catalog: app.get(CatalogService),
  ledger: app.get(LedgerService),
  vehicles: app.get(COURIER_VEHICLES),
};
const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };
const CITY = 'aziziyah';

/** Shared toolkit every section receives. */
const demo = {
  app,
  load,
  services,
  seedStorefronts,
  Accounts,
  CITY,
  /** Phone (any Iraqi form) → personId, by `key` as sections registered them. */
  people: new Map(),

  json(res, status, body) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  },

  /** Registers an Express handler; errors come back as 500 with the stack. */
  route(path, handler) {
    if (!path.startsWith('/demo/')) throw new Error(`demo routes live under /demo/: ${path}`);
    demoRouter.use(path.slice('/demo'.length), async (req, res) => {
      try {
        const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
        await handler({ req, res, url, query: Object.fromEntries(url.searchParams) });
      } catch (err) {
        demo.json(res, 500, { error: String(err?.stack ?? err) });
      }
    });
  },

  /** A person by phone with a name, roles and (for drivers) a registered vehicle. Idempotent. */
  async person({ key, phone, name, roles = [], vehicle = null, plate = null }) {
    const personId = await services.identity.ensurePersonByPhone(phone, SYSTEM.personId, 'demo');
    if (name) await services.identity.setName({ personId, sessionId: 'demo' }, name);
    for (const kind of roles) await services.identity.grantRole(SYSTEM, { personId, kind }).catch(() => undefined);
    if (vehicle) services.vehicles.register?.(personId, { vehicleClass: vehicle, plate: plate ?? 'واسط 00000', label: null });
    if (key) demo.people.set(key, { personId, phone, name, vehicle });
    return personId;
  },

  /** Resolves `?who=<key>` or `?personId=` to a person record. */
  who(query) {
    if (query.personId) return { personId: query.personId };
    const p = demo.people.get(query.who ?? '');
    if (!p) throw new Error(`unknown who=${query.who}; known: ${[...demo.people.keys()].join(', ')}`);
    return p;
  },

  online(personId, at, vehicle = 'bike', tier = 'bronze') {
    return services.dispatch.presence.online(personId, { cityId: CITY, at, vehicle, tier });
  },

  /** Ledger group helper (same shape the ledger's posting builders produce). */
  group(id, at, lines, refs = {}) {
    return { id, kind: 'money', occurredAt: at, refs, lines, controls: [] };
  },

  hoursAgo(h) {
    return new Date(Date.now() - h * 3_600_000);
  },
};

const sections = readdirSync(join(here, 'demo'))
  .filter((f) => f.endsWith('.mjs'))
  .sort();
for (const file of sections) {
  const mod = await import(pathToFileURL(join(here, 'demo', file)).href);
  if (typeof mod.default !== 'function') throw new Error(`scripts/demo/${file} must export a default register(demo) function`);
  await mod.default(demo);
  console.log(`DEMO_API section ${file}`);
}

demo.route('/demo/people', ({ res }) => demo.json(res, 200, Object.fromEntries([...demo.people].map(([k, v]) => [k, v]))));

await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (people: ${[...demo.people.keys()].join(', ')})`);
