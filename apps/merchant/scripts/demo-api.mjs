// Demo API for driving the Merchant app on web (screenshots, manual QA). Runs the BUILT API
// (apps/api/dist — run `pnpm build` first) fully in memory: no Postgres/Redis, dev OTPs readable
// through identity.devLastOtp.
//
//   PORT=3302 node apps/merchant/scripts/demo-api.mjs        (port 3302 by default)
//
// Core (this file): the four launch restaurants (@driver/contracts/seeds) plus extra Khalid dishes
// (كص، باجة، تكة غنم), and three demo people:
//   0770 123 4567  owner of مطعم خالد            → straight to the board
//   0770 999 0000  staff at خالد and الحاج كريم  → store picker
//   0770 111 0000  علي, staff at خالد             → straight to the board (staff: no money, no «مين سوّى شنو»)
//   0770 555 0000  no store                      → "حسابك بعده ما متفعّل"
// GET /demo/seed lists stores and people.
//
// Sections: every `scripts/demo/*.mjs` is loaded in name order. Each default-exports
// `async function register(ctx)` that seeds its data and adds its own `/demo/<section>/…` hooks with
// `ctx.route(path, handler)`. Wave 2 adds files there (menu.mjs, money.mjs…) instead of editing this
// one. `ctx` is documented on `makeContext()` below.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const apiDir = fileURLToPath(new URL('../../api/', import.meta.url));
const requireFromApi = createRequire(join(apiDir, 'package.json'));
requireFromApi('reflect-metadata');
const load = (p) => import(pathToFileURL(join(apiDir, 'dist', p)).href);

const PORT = Number(process.env.PORT ?? 3302);

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

const { createApp } = await load('bootstrap.js');
const { OrdersService } = await load('modules/orders/index.js');
const { OrgsService } = await load('modules/orgs/index.js');
const { CatalogService, seedStorefronts } = await load('modules/catalog/index.js');
const { IdentityService } = await load('modules/identity/index.js');
const { TripsService } = await load('modules/trips/index.js');
const { DispatchService } = await load('modules/dispatch/index.js');
const { LedgerService, Accounts } = await load('modules/ledger/index.js');
const { COURIER_VEHICLES } = await load('modules/tracking/index.js');

const app = await createApp();
/**
 * Demo hooks live in one table so sections can add them after `app.init()` (Nest closes the router
 * with its 404 handler at init). Longest matching path prefix wins.
 */
const routes = new Map();
app.use('/demo', async (req, res, next) => {
  const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://x');
  const path = [...routes.keys()].filter((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
  if (!path) return next();
  try {
    const out = await routes.get(path)(req, res, url);
    if (!res.headersSent) json(res, 200, out ?? { ok: true });
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: String(err?.stack ?? err) });
  }
});
// Lifecycle hooks (event publisher, dispatch subscribers, timers) start here, before sections seed:
// accepting an order must create its courier trip like it does in production.
await app.init();
const services = {
  orgs: app.get(OrgsService),
  catalog: app.get(CatalogService),
  orders: app.get(OrdersService),
  identity: app.get(IdentityService),
  trips: app.get(TripsService),
  dispatch: app.get(DispatchService),
  ledger: app.get(LedgerService),
  vehicles: app.get(COURIER_VEHICLES),
};
const { orgs, catalog, identity } = services;

// ───────────────────────── stores ─────────────────────────

const seeded = await seedStorefronts(orgs, catalog, undefined, 'demo-owner');
// Demo restaurants stay open around the clock so screens and shots work at any hour
// (DEMO_HOURS=real keeps the real opening hours, e.g. to show the "closed" states).
if (process.env.DEMO_HOURS !== 'real') {
  for (const s of seeded) {
    const front = await catalog.storefront(s.orgId);
    if (front && front.hours.length > 0) await catalog.saveStorefront({ ...front, hours: [] });
  }
}
// Five weeks of history (scripts/demo/lib/khalid-history.mjs) include small real-life orders below
// today's minimum; the demo places them with the minimum off and restores it afterwards.
const demoMinimums = new Map();
for (const s of seeded) {
  const front = await catalog.storefront(s.orgId);
  if (front && front.minOrderIqd > 0) {
    demoMinimums.set(s.orgId, front.minOrderIqd);
    await catalog.saveStorefront({ ...front, minOrderIqd: 0 });
  }
}
await orgs.settled?.();
const byKey = (key) => seeded.find((s) => s.seed.key === key);
const khalid = byKey('khalid');
const kareem = byKey('haj_kareem');

/** Khalid's grill beyond the launch seed: كص، باجة، تكة غنم (what an Aziziyah grill sells at night). */
const EXTRA = [
  { key: 'gus_wrap', nameAr: 'لفة كص', priceIqd: 3000, prepTimeMin: 8, categoryAr: 'لفات' },
  { key: 'gus_plate', nameAr: 'صحن كص', priceIqd: 6500, prepTimeMin: 12, categoryAr: 'وجبات' },
  { key: 'pacha', nameAr: 'باجة رأس', priceIqd: 9000, prepTimeMin: 10, categoryAr: 'وجبات' },
  { key: 'lamb_tikka_plate', nameAr: 'تكة غنم صحن', priceIqd: 9000, prepTimeMin: 20, categoryAr: 'مشويات' },
  { key: 'grill_mix_kilo', nameAr: 'مشويات مشكّلة كيلو', priceIqd: 22000, prepTimeMin: 30, categoryAr: 'مشويات' },
];
for (const [i, item] of EXTRA.entries()) {
  const created = await catalog.addItem({ id: `${khalid.orgId}_${item.key}`, orgId: khalid.orgId, nameAr: item.nameAr, priceIqd: item.priceIqd, prepTimeMin: item.prepTimeMin, categoryAr: item.categoryAr, sortOrder: 100 + i, modifierGroups: [] });
  khalid.itemIds.set(item.key, created.id);
}

// ───────────────────────── people ─────────────────────────

const SYSTEM = { personId: 'system:demo', sessionId: 'demo' };
async function person(phone, name) {
  const id = await identity.ensurePersonByPhone(phone, 'system:demo', 'demo');
  if (name) await identity.updateProfile({ personId: id, sessionId: 'demo' }, { name });
  return id;
}
const people = {
  owner: { phone: '07701234567', id: await person('07701234567', 'خالد') },
  multi: { phone: '07709990000', id: await person('07709990000', 'مصطفى') },
  inactive: { phone: '07705550000', id: await person('07705550000', 'سجاد') },
  ali: { phone: '07701110000', id: await person('07701110000', 'علي') },
};
await identity.grantRole(SYSTEM, { personId: people.owner.id, kind: 'merchant_owner', orgId: khalid.orgId });
await identity.grantRole(SYSTEM, { personId: people.multi.id, kind: 'merchant_staff', orgId: khalid.orgId });
await identity.grantRole(SYSTEM, { personId: people.multi.id, kind: 'merchant_staff', orgId: kareem.orgId });
await identity.grantRole(SYSTEM, { personId: people.ali.id, kind: 'merchant_staff', orgId: khalid.orgId });

// ───────────────────────── context for sections ─────────────────────────


/**
 * What a section gets:
 *   app, load(path)            the Nest app and a loader for apps/api/dist modules
 *   services                   orgs, catalog, orders, identity, trips, dispatch, ledger, vehicles
 *   Accounts                   ledger account names (merchantCash(orgId), driver(id)…)
 *   stores: { khalid, kareem, all }   seeded storefronts ({ orgId, seed, itemIds: key → item id })
 *   people: { owner, multi, inactive, ali } ({ phone, id })
 *   line(store, key, qty, { choose: ['صمون حجري'], note, participantRef })   an order line with
 *                              required modifiers resolved by option name
 *   route(path, handler)       adds an Express-style hook; handler(req, res, url) may return a value
 *                              (sent as JSON) or throw (500 with the stack)
 *   json(res, status, body)
 */
function makeContext() {
  async function line(store, key, qty, opts = {}) {
    const id = store.itemIds.get(key);
    if (!id) throw new Error(`no item ${key} at ${store.seed.key}`);
    const [item] = await catalog.itemsOf(store.orgId, [id]);
    const modifiers = [];
    for (const g of item.modifierGroups) {
      const wanted = g.modifiers.filter((m) => (opts.choose ?? []).includes(m.nameAr));
      const picks = wanted.length ? wanted : g.required ? [g.modifiers[0]] : [];
      for (const m of picks) modifiers.push({ groupId: g.id, modifierId: m.id });
    }
    return { catalogItemId: id, qty, modifiers, ...(opts.note ? { note: opts.note } : {}), ...(opts.participantRef ? { participantRef: opts.participantRef } : {}) };
  }
  const route = (path, handler) => {
    if (!path.startsWith('/demo/')) throw new Error(`demo routes live under /demo/: ${path}`);
    routes.set(path, handler);
  };
  return { app, load, services, Accounts, stores: { khalid, kareem, all: seeded }, people, line, route, json };
}

const ctx = makeContext();
ctx.route('/demo/seed', () => ({
  stores: seeded.map((s) => ({ key: s.seed.key, orgId: s.orgId, name: s.seed.nameAr })),
  people: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v])),
}));

const sectionDir = join(here, 'demo');
const sections = readdirSync(sectionDir).filter((f) => f.endsWith('.mjs')).sort();
for (const file of sections) {
  const mod = await import(pathToFileURL(join(sectionDir, file)).href);
  await mod.default(ctx);
  console.log(`DEMO_API section ${file}`);
}

for (const [orgId, minOrderIqd] of demoMinimums) {
  const front = await catalog.storefront(orgId);
  if (front) await catalog.saveStorefront({ ...front, minOrderIqd });
}
await app.listen(PORT);
console.log(`DEMO_API ready http://127.0.0.1:${PORT}/trpc (khalid=${khalid.orgId}, owner=${people.owner.phone})`);
