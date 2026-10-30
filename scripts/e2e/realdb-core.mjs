// Real-database core flows (CI job `e2e-postgres`, docs/ci.md § "e2e-postgres").
//
// A thin tRPC client against the BUILT API already running on Postgres + Redis (NODE_ENV=test,
// LOG_FORMAT=json). Five flows, each with its own new phone number(s) and its own `x-request-id`
// prefix, so every error the API logs can be pinned on the flow that caused it:
//
//   signin  e2e-signin-   requestOtp → devLastOtp (SMS_PROVIDER=fake) → verifyOtp → me
//   food    e2e-food-     a seeded restaurant: orders.quote → orders.place (cash)
//   sos     e2e-sos-      emergency contact set, a ride placed, safety.sos raised
//   ride    e2e-ride-     pricing.quote → orders.place with the quote id (what the app sends)
//   share   e2e-share-    a ride, a share link, a driver assigned (dispatch.override + accept), tracking.shared
//
// Twelve more, the customer paths end to end (delivery, cancels, rides, SOS, household, الرجعة seats,
// the request board, profile, places, browsing, scheduled and gift orders, double taps), live in
// scripts/e2e/customer-paths.mjs and run on this same harness.
//
// After the flows it waits for the outbox to settle, then reads the API's JSON log (from where it was
// when the run started) and `subscriber_deliveries`, and attributes every problem to a flow:
//   - log lines with level "error", every `Prisma` line (shared/db/prisma-error-log.ts) and every
//     "subscriber … failed" warning, by request id (`e2e-<flow>-…`) or, for outbox work
//     (`outbox-<rowId>`) and lines without one, by the flow's subject ids (people, orders, trips, incidents);
//   - subscriber deliveries that failed (`last_error` set or `attempts > 1`), by the same subject ids.
// A flow fails on any attributed problem, a 5xx, or an unexpected result. A problem no flow owns fails
// the run.
//
// scripts/e2e/known-failures.json maps issue id → flow. A failing flow that is listed is "known" and
// does not fail the run; a listed flow that now PASSES fails the run ("remove <issue> from
// known-failures.json"), so the list can only shrink.
//
//   E2E_API_URL   default http://localhost:3999
//   E2E_API_LOG   the API's stdout (JSON lines), default ./api.log
//   DATABASE_URL  the API's database (subscriber_deliveries / outbox reads)
//   E2E_ADMIN_PHONE  the seeded admin (`SEED_ADMIN_PHONE` at seed time), default 07700000099
//   FLOWS=signin,sos  run some flows only (the ratchet then only judges those)
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireFromApp = createRequire(join(root, 'apps/customer/package.json'));
const requireFromDb = createRequire(join(root, 'packages/db/package.json'));
const fromApp = (id) => import(pathToFileURL(requireFromApp.resolve(id)).href);

const API = (process.env.E2E_API_URL ?? 'http://localhost:3999').replace(/\/$/, '');
const LOG = process.env.E2E_API_LOG ?? 'api.log';
const KNOWN_FILE = join(root, 'scripts/e2e/known-failures.json');
const ADMIN_PHONE = process.env.E2E_ADMIN_PHONE ?? '07700000099';
const CITY = 'aziziyah';
const RUN = Date.now().toString(36);

const { createTRPCClient, httpLink, TRPCClientError } = await fromApp('@trpc/client');
const { transformer } = await fromApp('@driver/contracts');
const pg = requireFromDb('pg');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A fresh Iraqi mobile number per person per run (a new person on a reused database too). */
let phoneSeq = 0;
const newPhone = () =>
  `0780${String((Date.now() + phoneSeq++ * 7919) % 10_000_000).padStart(7, '0')}`;

// ───────────────────────── flows ─────────────────────────

/** Flow context: its own request-id prefix, clients that stamp it, checks, subject ids. */
function flowContext(name) {
  let seq = 0;
  const f = {
    name,
    prefix: `e2e-${name}-`,
    subjects: new Set(),
    unexpected: [],
    http5xx: [],
    checks: 0,
    client(token) {
      return createTRPCClient({
        links: [
          httpLink({
            url: `${API}/trpc`,
            transformer,
            headers: () => ({
              'x-request-id': `${f.prefix}${RUN}-${++seq}`,
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            }),
          }),
        ],
      });
    },
    subject(...ids) {
      for (const id of ids) if (typeof id === 'string' && id.length >= 6) f.subjects.add(id);
    },
    check(cond, what, detail) {
      f.checks += 1;
      if (!cond)
        f.unexpected.push(
          `${what}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
        );
      return Boolean(cond);
    },
    /** Runs one call; a thrown error is recorded (5xx separately) and returns undefined. */
    async call(what, fn) {
      try {
        return await fn();
      } catch (err) {
        const status =
          err instanceof TRPCClientError
            ? (err.data?.httpStatus ?? err.meta?.response?.status)
            : undefined;
        const code =
          err instanceof TRPCClientError ? (err.data?.code ?? err.shape?.code) : undefined;
        const line = `${what}: ${status ?? 'no status'} ${code ?? ''} ${err.message}`.trim();
        if (typeof status === 'number' && status >= 500) f.http5xx.push(line);
        else f.unexpected.push(line);
        return undefined;
      }
    },
  };
  return f;
}

/** Sign-in through the real OTP flow (dev code: SMS_PROVIDER=fake, NODE_ENV≠production). */
async function signIn(f, phone, name) {
  const anon = f.client();
  const req = await f.call('identity.requestOtp', () => anon.identity.requestOtp.mutate({ phone }));
  if (!f.check(req, 'requestOtp answered')) return null;
  const otp = await f.call('identity.devLastOtp', () => anon.identity.devLastOtp.query({ phone }));
  if (!f.check(otp?.code, 'devLastOtp has a code')) return null;
  const out = await f.call('identity.verifyOtp', () =>
    anon.identity.verifyOtp.mutate({
      phone,
      code: otp.code,
      device: { fingerprint: `e2e-${phone}`, platform: 'web' },
    }),
  );
  if (!f.check(out?.tokens?.accessToken, 'verifyOtp returns tokens')) return null;
  f.subject(out.personId);
  const api = f.client(out.tokens.accessToken);
  if (name)
    await f.call('identity.updateProfile(name)', () => api.identity.updateProfile.mutate({ name }));
  return { personId: out.personId, api, token: out.tokens.accessToken };
}

/**
 * The seeded admin (grants roles, dispatches). Signed in once per run (one number has an hourly OTP
 * limit); each flow gets its own client on its own prefix with his token.
 */
let adminSession = null;
async function admin(f) {
  if (!adminSession) {
    const a = await signIn(f, ADMIN_PHONE);
    if (!a) return null;
    f.subjects.delete(a.personId); // shared across flows: not a subject of any one of them
    adminSession = { personId: a.personId, token: a.token };
  }
  return { personId: adminSession.personId, api: f.client(adminSession.token) };
}

const PICKUP = { zoneKey: 'hashimi', pin: { lat: 32.896, lng: 45.0675 } };
const DROPOFF = { zoneKey: 'street_30', pin: { lat: 32.9095, lng: 45.0635 } };
const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
const minute = () => new Date(Math.floor(Date.now() / 60_000) * 60_000);

function rideQuoteRequest(vertical) {
  return {
    cityId: CITY,
    vertical,
    stops: [
      { zoneId: PICKUP.zoneKey, type: 'pickup', pin: PICKUP.pin },
      { zoneId: DROPOFF.zoneKey, type: 'dropoff', pin: DROPOFF.pin },
    ],
    options: { doorPickup: false, streetHandover: false },
    at: minute(),
  };
}

/** A taxi ride as the app books it; `withQuoteId` false leaves the quote id out (the LOAD-01 bypass). */
async function placeRide(f, customer, { withQuoteId }) {
  const quote = await f.call('pricing.quote(taxi)', () =>
    customer.api.pricing.quote.query(rideQuoteRequest('taxi')),
  );
  if (!f.check(quote?.total > 0, 'pricing.quote returns a fare', quote)) return null;
  const ride = await f.call('orders.place(ride)', () =>
    customer.api.orders.place.mutate({
      cityId: CITY,
      type: 'ride',
      rideVertical: 'taxi',
      fareIqd: quote.total,
      ...(withQuoteId ? { quoteId: quote.id } : {}),
      options: { doorPickup: false },
      paymentMethod: 'cash',
      pickup: PICKUP,
      dropoff: DROPOFF,
      clientRequestId: `${f.name}_${RUN}_${phoneSeq}`,
    }),
  );
  if (!f.check(ride?.state === 'placed', 'ride placed', ride?.state)) return null;
  f.subject(ride.id, ride.tripId);
  return { quote, ride };
}

const FLOWS = {
  async signin(f) {
    const p = await signIn(f, newPhone());
    if (!p) return;
    const me = await f.call('identity.me', () => p.api.identity.me.query());
    f.check(me?.personId === p.personId, 'identity.me answers for the new person', me?.personId);
  },

  async food(f) {
    const a = await admin(f);
    const customer = await signIn(f, newPhone(), 'زبون الأكل');
    const owner = await signIn(f, newPhone(), 'صاحب المطعم');
    if (!a || !customer || !owner) return;
    // A seeded restaurant, open all day for the run (what its owner does in the Merchant app).
    const orgId = 'org_aziziyah_khalid';
    await f.call('identity.grantRole(merchant_owner)', () =>
      a.api.identity.grantRole.mutate({ personId: owner.personId, kind: 'merchant_owner', orgId }),
    );
    const days = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dow,
      shifts: [{ start: '00:00', end: '23:59' }],
    }));
    await f.call('merchant.setHours', () =>
      owner.api.merchant.setHours.mutate({ merchantOrgId: orgId, days, holidays: [] }),
    );
    const menu = await f.call('catalog.menu', () =>
      customer.api.catalog.menu.query({ merchantId: orgId, dropoff: HOME }),
    );
    const dish = menu?.categories
      .flatMap((c) => c.items)
      .find((i) => i.available && i.priceIqd >= 1000 && !i.modifierGroups.some((g) => g.required));
    if (!f.check(dish, 'the seeded menu has an orderable dish')) return;
    const input = {
      cityId: CITY,
      type: 'food',
      merchantOrgId: orgId,
      lines: [
        {
          catalogItemId: dish.id,
          qty: 2,
          unitPriceIqd: dish.priceIqd,
          modifiers: [],
          merchantOrgId: orgId,
        },
      ],
      participants: [],
      tipIqd: 0,
      options: { streetHandover: false },
      paymentMethod: 'cash',
      dropoff: HOME,
    };
    const quote = await f.call('orders.quote(food)', () => customer.api.orders.quote.query(input));
    if (!f.check(quote, 'orders.quote answers')) return;
    const order = await f.call('orders.place(food)', () =>
      customer.api.orders.place.mutate({ ...input, clientRequestId: `food_${RUN}` }),
    );
    if (!f.check(order?.state === 'placed', 'food order placed', order?.state)) return;
    f.subject(order.id, order.tripId);
    f.check(order.totalIqd >= dish.priceIqd * 2, 'server total covers the items', order.totalIqd);
    const t = await f.call('orders.track', () =>
      customer.api.orders.track.query({ orderId: order.id }),
    );
    f.check(t?.order?.state === 'placed', 'tracking shows the order placed', t?.order?.state);
  },

  async sos(f) {
    const customer = await signIn(f, newPhone(), 'زبون الطوارئ');
    if (!customer) return;
    const me = await f.call('identity.updateProfile(emergencyContact)', () =>
      customer.api.identity.updateProfile.mutate({
        emergencyContact: { name: 'أخوي', phone: newPhone(), relation: 'sibling' },
      }),
    );
    f.check(me?.emergencyContact, 'emergency contact saved', me?.emergencyContact);
    const placed = await placeRide(f, customer, { withQuoteId: false });
    if (!placed) return;
    const sos = await f.call('safety.sos', () =>
      customer.api.safety.sos.mutate({
        subject: { kind: 'order', id: placed.ride.id },
        position: { lat: PICKUP.pin.lat, lng: PICKUP.pin.lng, accuracyM: 10, at: new Date() },
        clientId: `sos_${RUN}_${phoneSeq}`,
      }),
    );
    if (!f.check(sos?.incidentId ?? sos?.id, 'safety.sos opens an incident', sos)) return;
    f.subject(sos.incidentId ?? sos.id);
    const st = await f.call('safety.status', () =>
      customer.api.safety.status.query({ incidentId: sos.incidentId ?? sos.id }),
    );
    f.check(st, 'safety.status reads the incident back', st);
  },

  async ride(f) {
    const customer = await signIn(f, newPhone(), 'زبون التكسي');
    if (!customer) return;
    const placed = await placeRide(f, customer, { withQuoteId: true });
    if (!placed) return;
    f.check(placed.ride.totalIqd === placed.quote.total, 'ride total = the quoted fare', {
      total: placed.ride.totalIqd,
      quote: placed.quote.total,
    });
  },

  async share(f) {
    const a = await admin(f);
    const customer = await signIn(f, newPhone(), 'زبون المشاركة');
    const driver = await signIn(f, newPhone(), 'حسين');
    if (!a || !customer || !driver) return;
    await f.call('identity.grantRole(driver)', () =>
      a.api.identity.grantRole.mutate({ personId: driver.personId, kind: 'driver' }),
    );
    const placed = await placeRide(f, customer, { withQuoteId: false });
    if (!placed) return;
    const link = await f.call('tracking.createShareLink', () =>
      customer.api.tracking.createShareLink.mutate({ orderId: placed.ride.id }),
    );
    if (!f.check(link?.token, 'share link created', link)) return;
    const before = await f.call('tracking.shared(before driver)', () =>
      f.client().tracking.shared.query({ token: link.token }),
    );
    f.check(before, 'share page opens before a driver is assigned', before?.state);
    // Dispatch: the dispatcher forces the ride on the new driver (he is offline), the driver accepts.
    let tripId = null;
    for (let i = 0; i < 20 && !tripId; i++) {
      tripId =
        (
          await f.call('orders.track(trip)', () =>
            customer.api.orders.track.query({ orderId: placed.ride.id }),
          )
        )?.trip?.id ?? null;
      if (!tripId) await sleep(300);
    }
    if (!f.check(tripId, 'the ride has a trip (orders.track)')) return;
    f.subject(tripId);
    const ov = await f.call('dispatch.override', () =>
      a.api.dispatch.override.mutate({
        tripId,
        driverId: driver.personId,
        force: true,
        reason: 'e2e: assign the test driver',
      }),
    );
    if (!f.check(ov?.offerId, 'dispatch.override sends him the ride', ov)) return;
    const resp = await f.call('dispatch.respond(accept)', () =>
      driver.api.dispatch.respond.mutate({ offerId: ov.offerId, accept: true }),
    );
    if (!f.check(resp?.outcome === 'assigned', 'driver accepts: assigned', resp)) return;
    const after = await f.call('tracking.shared(driver assigned)', () =>
      f.client().tracking.shared.query({ token: link.token, again: true }),
    );
    f.check(
      after && after.state !== 'ended',
      'share page still opens with the driver assigned',
      after?.state,
    );
  },
};

// The customer paths (scripts/e2e/customer-paths.mjs) run on the same harness.
const { customerPaths } = await import(
  pathToFileURL(join(root, 'scripts/e2e/customer-paths.mjs')).href
);
Object.assign(
  FLOWS,
  customerPaths({
    API,
    signIn,
    admin,
    newPhone,
    placeRide,
    sleep,
    CITY,
    RUN,
    PICKUP,
    DROPOFF,
    HOME,
    minute,
  }),
);

// ───────────────────────── run ─────────────────────────

const only = (process.env.FLOWS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const name of only)
  if (!FLOWS[name])
    throw new Error(`FLOWS: unknown flow "${name}" (known: ${Object.keys(FLOWS).join(', ')})`);
const selected = only.length ? only : Object.keys(FLOWS);

if (!existsSync(LOG))
  throw new Error(`E2E_API_LOG: ${LOG} does not exist (the API's stdout, LOG_FORMAT=json)`);
const logOffset = statSync(LOG).size;
const db = process.env.DATABASE_URL
  ? new pg.Client({ connectionString: process.env.DATABASE_URL })
  : null;
if (!db) throw new Error('DATABASE_URL is required (subscriber_deliveries attribution)');
await db.connect();
const startedAt = (await db.query('SELECT now() AS t')).rows[0].t;

const flows = [];
console.log(`realdb-core: ${selected.join(', ')} against ${API} (run ${RUN})`);
for (const name of selected) {
  const f = flowContext(name);
  const t0 = Date.now();
  try {
    await FLOWS[name](f);
  } catch (err) {
    f.unexpected.push(`threw: ${err?.stack ?? err}`);
  }
  f.ms = Date.now() - t0;
  flows.push(f);
  console.log(
    `  ${name}: ${f.checks} checks, ${f.unexpected.length} unexpected, ${f.http5xx.length} × 5xx (${f.ms} ms)`,
  );
}

// Let the outbox and the notification sends make their first attempt at what the flows wrote (a
// retry is scheduled later and already carries its error).
for (let i = 0; i < 40; i++) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM "public"."outbox" WHERE created_at >= $1 AND status = 'pending' AND attempts = 0)
          + (SELECT count(*) FROM "public"."notify_deliveries" WHERE created_at >= $1 AND status = 'queued' AND attempts = 0 AND (not_before IS NULL OR not_before <= now())) AS n`,
    [startedAt],
  );
  if (Number(rows[0].n) === 0) break;
  await sleep(500);
}
await sleep(2500);

// ───────────────────────── attribution ─────────────────────────

/** Outbox and notify rows named in a log line (`ob_…`, `ntf_…`): what they were about, and when. */
const rowCache = new Map();
async function referencedRows(text) {
  const out = [];
  for (const [re, sql] of [
    [
      /\bob_[a-z0-9]{8,}/g,
      `SELECT created_at, concat_ws(' ', aggregate_id, payload::text) AS about FROM "public"."outbox" WHERE id = $1`,
    ],
    [
      /\bntf_[a-z0-9]{8,}/g,
      `SELECT created_at, concat_ws(' ', person_id, order_id, event_id, dedupe_key, payload::text) AS about FROM "public"."notify_deliveries" WHERE id = $1`,
    ],
  ]) {
    for (const [id] of text.matchAll(re)) {
      if (!rowCache.has(id)) rowCache.set(id, (await db.query(sql, [id])).rows[0] ?? null);
      if (rowCache.get(id)) out.push(rowCache.get(id));
    }
  }
  return out;
}
/** The flow whose subject ids appear in `text`. */
function bySubjects(text) {
  for (const f of flows) for (const id of f.subjects) if (text.includes(id)) return f;
  return null;
}
/**
 * Which flow a problem belongs to: its request id prefix; else the subject ids in the line, its
 * request id (`outbox-<row>`, `job-<queue>-<name>-<id>`, job ids name their subject) or the outbox /
 * notify rows it names. `stale`: it is about rows written before this run (a retry left by an
 * earlier run on a reused database), reported but not judged.
 */
async function attribute(requestId, text) {
  const f = requestId && flows.find((x) => requestId.startsWith(x.prefix));
  if (f) return { flow: f };
  const all = `${requestId ?? ''} ${text}`;
  const direct = bySubjects(all);
  if (direct) return { flow: direct };
  const rows = await referencedRows(all);
  for (const r of rows) {
    const g = bySubjects(r.about);
    if (g) return { flow: g };
  }
  return { flow: null, stale: rows.length > 0 && rows.every((r) => r.created_at < startedAt) };
}

const problems = []; // { flow|null, source, text }
const raw = readFileSync(LOG).subarray(logOffset).toString('utf8');
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue; // not one of the API's JSON lines (Node warnings, Prisma banners)
  }
  const msg = String(e.msg ?? '');
  const isProblem =
    e.level === 'error' ||
    e.context === 'Prisma' ||
    (e.level === 'warn' && /^subscriber \S+ failed on /.test(msg));
  if (!isProblem) continue;
  const { flow: f, stale } = await attribute(e.requestId, `${msg} ${e.stack ?? ''}`);
  problems.push({
    flow: f,
    stale,
    source: e.context === 'Prisma' ? 'prisma' : e.level === 'error' ? 'log error' : 'subscriber',
    text: `${e.requestId ? `[${e.requestId}] ` : ''}${e.context ? `${e.context}: ` : ''}${msg}`,
  });
}

const { rows: deliveries } = await db.query(
  `SELECT sd.subscriber, sd.attempts, sd.last_error, o.id, o.type, o.aggregate_id, o.payload::text AS payload
     FROM "public"."subscriber_deliveries" sd JOIN "public"."outbox" o ON o.id = sd.outbox_id
    WHERE o.created_at >= $1 AND (sd.attempts > 1 OR sd.last_error IS NOT NULL)`,
  [startedAt],
);
for (const d of deliveries) {
  problems.push({
    flow: bySubjects(`${d.aggregate_id} ${d.payload}`),
    source: 'delivery',
    text: `${d.subscriber} on ${d.type} (outbox ${d.id}, attempts ${d.attempts}): ${String(d.last_error ?? '').slice(0, 300)}`,
  });
}
// Notification sends that hit an error (a vault read refused, …): retried or given up.
const { rows: sends } = await db.query(
  `SELECT id, template, channel, status, attempts, reason, concat_ws(' ', person_id, order_id, event_id, dedupe_key, payload::text) AS about
     FROM "public"."notify_deliveries"
    WHERE created_at >= $1 AND (reason LIKE 'retry:%' OR status = 'failed')`,
  [startedAt],
);
for (const n of sends) {
  problems.push({
    flow: bySubjects(n.about),
    source: 'send',
    text: `${n.template}/${n.channel} ${n.status} (notify ${n.id}, attempts ${n.attempts}): ${String(
      n.reason ?? '',
    )
      .replace(/\s+/g, ' ')
      .slice(0, 300)}`,
  });
}
await db.end();

// ───────────────────────── verdict (with the known-failures ratchet) ─────────────────────────

const known = JSON.parse(readFileSync(KNOWN_FILE, 'utf8'));
const knownByFlow = new Map();
const verdictErrors = [];
for (const [issue, value] of Object.entries(known)) {
  for (const flow of Array.isArray(value) ? value : [value]) {
    if (!FLOWS[flow])
      verdictErrors.push(
        `known-failures.json: ${issue} names no flow "${flow}" (flows: ${Object.keys(FLOWS).join(', ')})`,
      );
    if (!knownByFlow.has(flow)) knownByFlow.set(flow, []);
    knownByFlow.get(flow).push(issue);
  }
}

const rows = [];
let red = false;
for (const f of flows) {
  const mine = problems.filter((p) => p.flow === f);
  const failed = f.unexpected.length > 0 || f.http5xx.length > 0 || mine.length > 0;
  const issues = knownByFlow.get(f.name) ?? [];
  let verdict;
  if (failed && issues.length) verdict = `known (${issues.join(', ')})`;
  else if (failed) {
    verdict = 'FAIL';
    red = true;
  } else if (issues.length) {
    verdict = `FAIL: passes now — remove ${issues.join(', ')} from known-failures.json`;
    red = true;
  } else verdict = 'pass';
  rows.push({ f, mine, failed, verdict });
}
const unmatched = problems.filter((p) => !p.flow && !p.stale);
const stale = problems.filter((p) => !p.flow && p.stale);
if (unmatched.length) red = true;
if (verdictErrors.length) red = true;

const pad = (s, n) => String(s).padEnd(n);
const one = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 300);
// Columns: checks run, unexpected results, HTTP 5xx, then attributed problems by source.
const SOURCES = [
  ['prisma', 'prisma'], // a failed query (shared/db/prisma-error-log.ts)
  ['log error', 'error'], // a level=error line (tRPC INTERNAL_SERVER_ERROR, outbox gave up, …)
  ['subscriber', 'subscr'], // "subscriber … failed on …" (an outbox retry)
  ['delivery', 'deliv'], // subscriber_deliveries with last_error or attempts > 1
  ['send', 'sends'], // notify_deliveries retried or failed
];
const cells = (list) =>
  SOURCES.map(([src, h]) => pad(list.filter((p) => p.source === src).length, h.length + 1));
console.log(
  '\n' +
    [
      pad('flow', 8),
      pad('checks', 7),
      pad('unexp', 6),
      pad('5xx', 4),
      ...SOURCES.map(([, h]) => pad(h, h.length + 1)),
      'verdict',
    ].join(' '),
);
console.log('-'.repeat(110));
for (const { f, mine, verdict } of rows)
  console.log(
    [
      pad(f.name, 8),
      pad(f.checks, 7),
      pad(f.unexpected.length, 6),
      pad(f.http5xx.length, 4),
      ...cells(mine),
      verdict,
    ].join(' '),
  );
console.log(
  [
    pad('(none)', 8),
    pad('', 7),
    pad('', 6),
    pad('', 4),
    ...cells(unmatched),
    unmatched.length ? 'FAIL: problems no flow owns' : 'ok',
  ].join(' '),
);

const MAX = 8;
for (const { f, mine, failed } of rows) {
  if (!failed) continue;
  console.log(`\n[${f.name}]`);
  for (const u of f.unexpected) console.log(`  unexpected: ${one(u)}`);
  for (const u of f.http5xx) console.log(`  5xx: ${one(u)}`);
  for (const p of mine.slice(0, MAX)) console.log(`  ${p.source}: ${one(p.text)}`);
  if (mine.length > MAX) console.log(`  … ${mine.length - MAX} more`);
}
if (unmatched.length) {
  console.log('\n[no flow] — every problem must belong to a flow');
  for (const p of unmatched.slice(0, MAX * 2)) console.log(`  ${p.source}: ${one(p.text)}`);
  if (unmatched.length > MAX * 2) console.log(`  … ${unmatched.length - MAX * 2} more`);
}
if (stale.length)
  console.log(
    `\n(${stale.length} problem(s) about rows from an earlier run on this database, not judged)`,
  );
for (const v of verdictErrors) console.log(`\n${v}`);
console.log(
  `\nrealdb-core: ${red ? 'RED' : 'GREEN'} — ${rows.filter((r) => !r.failed).length} pass, ${rows.filter((r) => r.failed && knownByFlow.has(r.f.name)).length} known, ${rows.filter((r) => r.verdict.startsWith('FAIL')).length} failing, ${unmatched.length} unattributed`,
);
process.exit(red ? 1 : 0);
