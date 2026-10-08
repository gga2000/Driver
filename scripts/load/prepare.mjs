// Load test (plan §7.1, docs/launch/load-test.md): the people the traffic runs as, and what it needs to know.
//
//   node scripts/load/prepare.mjs --customers 1500 --profile 1x --out .load   (or --sessions N)
//   node scripts/load/prepare.mjs --revoke                                  (after a run)
//
// Writes, idempotently, into DATABASE_URL (the staging database, or a local one):
//   - load customers `load_c_00001…`, one owner per launch kitchen `load_m_<kitchen>`, food couriers
//     `load_k_00001…` (with a passed check-in for today and tomorrow) and one field-ops person `load_ops`
//     who takes the couriers' cash: people, their vault identity (a made-up number in +964 7999 1…4xxxxx,
//     never a real phone; the phone hash is unpeppered and so can never sign anyone in) and their role;
//   - fresh sessions (--sessions spread over the customers, three per kitchen owner, one per courier and
//     one per courier for the field-ops person): the old load sessions
//     are revoked, new refresh tokens are generated HERE and only their SHA-256 reaches the database,
//     exactly as the API stores them (session.service.ts).
// and two files in --out:
//   - tokens.json (mode 600): the refresh tokens. k6 trades each for an access token through the real
//     `identity.refresh`, so no signing key ever leaves the API. Never print it, never upload it: the
//     repository is public.
//   - world.json: the kitchens, their dishes and the zones' centres (no secrets), for orders and drop-offs.
//
// DATABASE_CA_CERT (optional PEM) verifies the database's TLS, as in scripts/deploy/supabase-setup.mjs.
// Refuses to run unless DATABASE_URL is local or LOAD_TARGET=staging with DEPLOY_ENVIRONMENT=staging.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlan } from './k6/profiles.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Client } = createRequire(join(root, 'packages/db/package.json'))('pg');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const CUSTOMERS = Number(opt('customers', '1500'));
/**
 * Sessions to spread over the customers: one per virtual user plus one per app visit. --profile (with
 * the run's --k / --duration, if overridden) works it out exactly as the k6 script does.
 */
const PROFILE = opt('profile');
const RUN = PROFILE ? runPlan(PROFILE, { k: opt('k'), duration: opt('duration') }) : null;
const SESSIONS = RUN ? RUN.sessions : Number(opt('sessions', String(CUSTOMERS)));
/** Food couriers (the profile's, or --couriers), plus one field-ops person who takes their cash. */
const COURIERS = RUN ? RUN.couriers : Number(opt('couriers', '6'));
/** --revoke: end every load session (after a run) and write nothing. */
const REVOKE_ONLY = args.includes('--revoke');
const OUT = opt('out', '.load');
const CITY = 'aziziyah';
/** Sessions outlive the longest run (2 h at 1×) with room to spare. */
const SESSION_HOURS = 6;

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set');
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && !(process.env.LOAD_TARGET === 'staging' && process.env.DEPLOY_ENVIRONMENT === 'staging')) {
  fail('refusing: the database is not local and this is not marked staging (LOAD_TARGET=staging, DEPLOY_ENVIRONMENT=staging)');
}
if (!Number.isInteger(CUSTOMERS) || CUSTOMERS < 1 || CUSTOMERS > 99_999) fail('--customers must be 1..99999');
if (!Number.isInteger(SESSIONS) || SESSIONS < 1 || SESSIONS > 200_000) fail('--sessions must be 1..200000');
if (!Number.isInteger(COURIERS) || COURIERS < 0 || COURIERS > 9_999) fail('--couriers must be 0..9999');

function fail(message) {
  console.error(`load prepare: ${message}`);
  process.exit(1);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
/** Baghdad's calendar date (UTC+3, no daylight saving), `days` from now: YYYY-MM-DD. */
const baghdadDate = (at, days) => new Date(at.getTime() + 3 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
const pad = (n, w) => String(n).padStart(w, '0');

/** Same TLS rules as @driver/db pgPoolConfig: with DATABASE_CA_CERT, verify against it and drop sslmode from the URL. */
function pgConfig(connectionString) {
  const raw = process.env.DATABASE_CA_CERT?.trim();
  if (!raw) return { connectionString };
  const ca = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  const u = new URL(connectionString);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

const db = new Client({ ...pgConfig(url), connectionTimeoutMillis: 15_000 });
await db.connect();
if (REVOKE_ONLY) {
  const r = await db.query(
    `UPDATE public.sessions SET revoked_at = now(), updated_at = now()
      WHERE revoked_at IS NULL AND person_id ~ '^load_(c|m|k)_|^load_ops$'`,
  );
  console.log(`load prepare: ${r.rowCount} load sessions ended`);
  await db.end();
  process.exit(0);
}
try {
  const kitchens = (
    await db.query(
      `SELECT o.id, o.name FROM public.orgs o JOIN public.catalogs c ON c.org_id = o.id AND c.active
        WHERE o.type = 'restaurant' AND o.city_id = $1 AND o.id LIKE 'org_aziziyah_%' ORDER BY o.id`,
      [CITY],
    )
  ).rows;
  if (kitchens.length === 0) fail('no launch kitchens in this database (run the seed first)');

  const people = [];
  for (let i = 1; i <= CUSTOMERS; i++) people.push({ id: `load_c_${pad(i, 5)}`, phone: `+96479991${pad(i, 5)}`, role: 'customer', orgId: null });
  kitchens.forEach((k, i) => people.push({ id: `load_m_${k.id.replace('org_aziziyah_', '')}`, phone: `+96479992${pad(i + 1, 5)}`, role: 'merchant_owner', orgId: k.id }));
  for (let i = 1; i <= COURIERS; i++) people.push({ id: `load_k_${pad(i, 5)}`, phone: `+96479993${pad(i, 5)}`, role: 'courier', orgId: null });
  if (COURIERS > 0) people.push({ id: 'load_ops', phone: '+9647999400001', role: 'field_ops', orgId: null });

  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  const tokens = { customers: [], merchants: [], couriers: [] };
  await db.query('BEGIN');
  for (let at = 0; at < people.length; at += 500) {
    const batch = people.slice(at, at + 500);
    const ids = batch.map((p) => p.id);
    await db.query(
      `INSERT INTO public.people (id, locale, trust_tier, last_verified_at, updated_at)
         SELECT unnest($1::text[]), 'ar-IQ', 'new', $2, $2 ON CONFLICT (id) DO NOTHING`,
      [ids, now],
    );
    await db.query(
      `INSERT INTO identity_vault.person_identities (id, person_id, phone_e164, phone_hash, name, updated_at)
         SELECT 'pid_' || p, p, ph, h, 'حمل ' || right(p, 5), $4
           FROM unnest($1::text[], $2::text[], $3::text[]) AS t(p, ph, h)
         ON CONFLICT (person_id) DO NOTHING`,
      [ids, batch.map((p) => p.phone), batch.map((p) => sha256(`load:${p.phone}`)), now],
    );
    await db.query(
      `INSERT INTO public.roles (id, person_id, kind, org_id, granted_by, updated_at)
         SELECT 'rl_' || p || '_' || k, p, k::"RoleKind", o, 'system:load', $4
           FROM unnest($1::text[], $2::text[], $3::text[]) AS t(p, k, o)
         ON CONFLICT DO NOTHING`,
      [ids, batch.map((p) => p.role), batch.map((p) => p.orgId), now],
    );
    // A courier goes online only after today's selfie check-in (driver-account checkInStatusFor): a
    // passed one for today and tomorrow (Baghdad dates), so a run crossing midnight keeps its couriers.
    const couriers = batch.filter((p) => p.role === 'courier').map((p) => p.id);
    if (couriers.length > 0) {
      for (const day of [baghdadDate(now, 0), baghdadDate(now, 1)]) {
        await db.query(
          `INSERT INTO public.driver_check_ins (id, person_id, local_date, gesture, issued_at, expires_at, result, submitted_at, liveness_score, updated_at)
             SELECT 'chk_load_' || p || '_' || $2, p, $2, 'blink', $3, $3, 'passed'::"DriverCheckInResult", $3, 1, $3
               FROM unnest($1::text[]) AS t(p)
             ON CONFLICT (id) DO NOTHING`,
          [couriers, day, now],
        );
      }
    }
    // A run starts from fresh sessions: whatever an earlier run left is revoked, never reused.
    await db.query(`UPDATE public.sessions SET revoked_at = $2, updated_at = $2 WHERE person_id = ANY($1::text[]) AND revoked_at IS NULL`, [ids, now]);
  }

  // Sessions, like phones signed in: a refresh token rotates on every use and a reused one ends its
  // session, so every virtual user (and every app visit) needs one of its own. Customers get --sessions
  // of them spread over the people; each kitchen owner gets three: the kitchen's virtual user, the run's
  // setup (opening the kitchen for the run) and its teardown (putting the hours back). Setup and teardown
  // are separate so no token ever has to travel in k6's setup data, which lands in the run's summary.
  const customerIds = people.filter((p) => p.role === 'customer').map((p) => p.id);
  const plan = [];
  for (let j = 0; j < SESSIONS; j++) plan.push({ kind: 'customer', personId: customerIds[j % customerIds.length] });
  // Each courier gets one, and the field-ops person one per courier (to take that courier's cash when
  // he nears his cap, the way a cash hand-off works).
  for (const p of people) {
    if (p.role === 'merchant_owner') plan.push({ kind: 'merchant', personId: p.id, orgId: p.orgId }, { kind: 'setupToken', personId: p.id }, { kind: 'teardownToken', personId: p.id });
    if (p.role === 'courier') plan.push({ kind: 'courier', personId: p.id }, { kind: 'opsToken', personId: 'load_ops', courierId: p.id });
  }
  const refresh = plan.map(() => randomBytes(32).toString('base64url'));
  for (let at = 0; at < plan.length; at += 1000) {
    const slice = plan.slice(at, at + 1000);
    await db.query(
      `INSERT INTO public.sessions (id, person_id, refresh_token_hash, expires_at, created_at, updated_at)
         SELECT 'ses_load_' || md5(h), p, h, $3, $4, $4 FROM unnest($1::text[], $2::text[]) AS t(p, h)`,
      [slice.map((x) => x.personId), refresh.slice(at, at + 1000).map(sha256), expires, now],
    );
  }
  plan.forEach((x, j) => {
    if (x.kind === 'customer') tokens.customers.push({ personId: x.personId, refreshToken: refresh[j] });
    else if (x.kind === 'merchant') tokens.merchants.push({ personId: x.personId, orgId: x.orgId, refreshToken: refresh[j] });
    else if (x.kind === 'courier') tokens.couriers.push({ personId: x.personId, refreshToken: refresh[j] });
    else if (x.kind === 'opsToken') tokens.couriers.find((c) => c.personId === x.courierId).opsToken = refresh[j];
    else tokens.merchants.find((m) => m.personId === x.personId)[x.kind] = refresh[j];
  });
  await db.query('COMMIT');

  const dishes = (
    await db.query(
      `SELECT c.org_id AS "orgId", i.id, i.price_iqd AS "priceIqd" FROM public.catalog_items i
         JOIN public.catalogs c ON c.id = i.catalog_id
        WHERE c.org_id = ANY($1::text[]) AND i.available AND i.price_iqd >= 1000
          AND NOT EXISTS (SELECT 1 FROM public.modifier_groups g WHERE g.item_id = i.id AND g.required)
        ORDER BY c.org_id, i.id`,
      [kitchens.map((k) => k.id)],
    )
  ).rows;
  const zones = (
    await db.query(
      `SELECT key, ST_Y(COALESCE(centre::geometry, ST_Centroid(polygon::geometry))) AS lat,
              ST_X(COALESCE(centre::geometry, ST_Centroid(polygon::geometry))) AS lng
         FROM public.zones WHERE city_id = $1 ORDER BY key`,
      [CITY],
    )
  ).rows;

  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  writeFileSync(join(OUT, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });
  const world = {
    cityId: CITY,
    kitchens: kitchens.map((k) => ({ id: k.id, dishes: dishes.filter((d) => d.orgId === k.id).map((d) => ({ id: d.id, priceIqd: d.priceIqd })) })),
    dropoffs: zones.map((z) => ({ zoneKey: z.key, pin: { lat: Number(Number(z.lat).toFixed(5)), lng: Number(Number(z.lng).toFixed(5)) } })),
  };
  writeFileSync(join(OUT, 'world.json'), JSON.stringify(world, null, 2));
  console.log(`load prepare: ${CUSTOMERS} customers with ${tokens.customers.length} sessions, ${tokens.merchants.length} kitchen owners, ${tokens.couriers.length} couriers, ${dishes.length} dishes, ${zones.length} zones → ${OUT}/`);
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  await db.end();
}
