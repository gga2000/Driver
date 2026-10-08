// Load test: six weeks of order history before the run (plan §7.1: 1,500 customers × 45 days × ~1,100
// orders a day), so "my orders", menus and history are as slow as they will be in week six, not day one.
//
//   node scripts/load/history.mjs --orders 49500 --days 45            (after prepare.mjs, on the same database)
//
// It copies real, finished orders. Templates are food orders the load test itself took all the way
// through the real API (placed → accepted → ridden → delivered → closed two hours later), with every row
// they left behind: the order and its lines, the trip, stops and offers, ETA samples, the domain events
// and their published outbox rows, and the ledger postings. Each copy gets new ids (`hist<n>_<old id>`,
// in every column and inside JSON), a load customer chosen so order counts per customer follow launch
// research (median 29, p99 114 over six weeks), and all its times moved to a day and hour of the past
// six weeks (lunch and dinner peaks, Baghdad time). Then each courier's day ends like a real one: he pays
// each kitchen what he holds for it and hands the rest to ops (ledger `merchant_paid_by_courier`,
// `driver_settlement`), so nobody starts the run over a cash cap.
//
// Nothing is replayed: outbox rows are copied already published, no timers are copied, so no copy
// sends a message or moves money again. The ledger is append-only, so history is only ever added:
// running it again tops up to --orders and never rewrites what is there.
//
// Refuses to run unless DATABASE_URL is local or LOAD_TARGET=staging with DEPLOY_ENVIRONMENT=staging.
// --allow-delivered also takes delivered orders not yet closed as templates (local trials only).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Client } = createRequire(join(root, 'packages/db/package.json'))('pg');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const TARGET = Number(opt('orders', '49500'));
const DAYS = Number(opt('days', '45'));
const CUSTOMERS = Number(opt('customers', '1500'));
const MIN_TEMPLATES = Number(opt('min-templates', '30'));
const ALLOW_DELIVERED = args.includes('--allow-delivered');
const SEED = Number(opt('seed', '1'));
/** Copies per statement: one transaction holds a template's copies for every table, so a failure leaves no half-copied order. */
const CHUNK = 250;

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set');
const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1';
if (!local && !(process.env.LOAD_TARGET === 'staging' && process.env.DEPLOY_ENVIRONMENT === 'staging')) {
  fail('refusing: the database is not local and this is not marked staging (LOAD_TARGET=staging, DEPLOY_ENVIRONMENT=staging)');
}
if (!Number.isInteger(TARGET) || TARGET < 1 || TARGET > 500_000) fail('--orders must be 1..500000');
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 120) fail('--days must be 1..120');

function fail(message) {
  console.error(`load history: ${message}`);
  process.exit(1);
}

/** Same TLS rules as @driver/db pgPoolConfig (and prepare.mjs). */
function pgConfig(connectionString) {
  const raw = process.env.DATABASE_CA_CERT?.trim();
  if (!raw) return { connectionString };
  const ca = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  const u = new URL(connectionString);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

// ───────────────────────── a repeatable random ─────────────────────────

let state = SEED >>> 0 || 1;
function rand() {
  // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function normal() {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ───────────────────────── what a copy is made of ─────────────────────────

/**
 * Tables copied with an order, in foreign-key order, and which of their rows belong to it
 * ($1 order ids, $2 trip ids, $3 event ids). Outbox rows only when already published.
 */
const TABLES = [
  ['orders', 'id = ANY($1)'],
  ['order_lines', 'order_id = ANY($1)'],
  ['participants', 'order_id = ANY($1)'],
  ['trips', 'id = ANY($2)'],
  ['trip_orders', 'order_id = ANY($1)'],
  ['stops', 'trip_id = ANY($2)'],
  ['dispatch_offers', 'trip_id = ANY($2)'],
  ['eta_samples', 'trip_id = ANY($2)'],
  ['events', 'order_id = ANY($1) OR trip_id = ANY($2) OR aggregate_id = ANY($1) OR aggregate_id = ANY($2)'],
  ['outbox', "status = 'published' AND (event_id = ANY($3) OR aggregate_id = ANY($1) OR aggregate_id = ANY($2))"],
  ['ledger_events', 'order_id = ANY($1) OR trip_id = ANY($2)'],
  ['courier_ratings', 'order_id = ANY($1)'],
  ['order_compliments', 'order_id = ANY($1)'],
];
/** Every statement binds all three id lists; this names them all so Postgres knows their types. */
const ALL_PARAMS = 'cardinality($1::text[]) + cardinality($2::text[]) + cardinality($3::text[]) >= 0';
/** Unique keys that carry no id of their own: suffixed per copy. */
const SUFFIXED = new Set(['events.idempotency_key', 'outbox.idempotency_key', 'ledger_events.idempotency_key', 'orders.client_request_id']);
/** References to rows that are not copied and must stay unique: cleared on the copy. */
const CLEARED = new Set(['orders.quote_id', 'trips.quote_id']);

const db = new Client({ ...pgConfig(url), connectionTimeoutMillis: 15_000, statement_timeout: 0 });
await db.connect();
try {
  // A timestamp inside JSON moves with the copy (payload `at`, `placedAt`…).
  await db.query(`
    CREATE OR REPLACE FUNCTION pg_temp.hist_shift_iso(doc text, shift_ms bigint) RETURNS text
    LANGUAGE plpgsql IMMUTABLE AS $f$
    DECLARE m text[]; out text := doc;
    BEGIN
      IF doc IS NULL OR shift_ms = 0 THEN RETURN doc; END IF;
      FOR m IN SELECT DISTINCT regexp_matches(doc, '"(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z)"', 'g') LOOP
        out := replace(out, '"' || m[1] || '"',
          '"' || to_char((m[1]::timestamptz + shift_ms * interval '1 millisecond') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '"');
      END LOOP;
      RETURN out;
    END $f$`);

  const customers = (await db.query(`SELECT id FROM public.people WHERE id LIKE 'load\\_c\\_%' ORDER BY id LIMIT $1`, [CUSTOMERS])).rows.map((r) => r.id);
  if (customers.length < CUSTOMERS) fail(`only ${customers.length} load customers: run prepare.mjs --customers ${CUSTOMERS} first`);

  const states = ALLOW_DELIVERED ? ['closed', 'delivered'] : ['closed'];
  const templates = (
    await db.query(
      `SELECT o.id, o.orderer_id, o.placed_at, array_agg(DISTINCT t.trip_id) AS trips
         FROM public.orders o JOIN public.trip_orders t ON t.order_id = o.id
        WHERE o.type = 'food' AND o.state::text = ANY($1) AND o.merchant_org_id LIKE 'org\\_aziziyah\\_%'
          AND o.orderer_id LIKE 'load\\_c\\_%' AND o.id NOT LIKE 'hist%'
          AND EXISTS (SELECT 1 FROM public.ledger_events l WHERE l.order_id = o.id AND l.type = 'cash_collected')
        GROUP BY o.id`,
      [states],
    )
  ).rows;
  if (templates.length < MIN_TEMPLATES) {
    fail(
      `${templates.length} finished load orders to copy, need ${MIN_TEMPLATES}: run the load test with couriers (smoke is enough), ` +
        `then wait two hours so its orders close${ALLOW_DELIVERED ? '' : ' (or --allow-delivered for a local trial)'}`,
    );
  }

  const done = Number((await db.query(`SELECT count(*)::int AS n FROM public.orders WHERE id LIKE 'hist%'`)).rows[0].n);
  const firstClone = Number((await db.query(`SELECT coalesce(max(substring(id from '^hist(\\d+)_')::int), 0) AS n FROM public.orders WHERE id LIKE 'hist%'`)).rows[0].n) + 1;
  const toMake = TARGET - done;
  if (toMake <= 0) {
    console.log(`load history: ${done} orders already there (target ${TARGET}); nothing to add`);
    process.exit(0);
  }

  // ── the plan: who orders how often, and when ──
  // Six-week order counts per customer: log-normal, median 29, p99 114 (σ = ln(114/29) / 2.326).
  const sigma = Math.log(114 / 29) / 2.326;
  const weights = customers.map(() => Math.exp(Math.log(29) + sigma * normal()));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / wsum) * toMake));
  for (let i = 0, short = toMake - counts.reduce((a, b) => a + b, 0); short > 0; i = (i + 1) % counts.length, short--) counts[i] += 1;

  const now = Date.now();
  const BAGHDAD_MS = 3 * 3_600_000;
  const todayLocal = Math.floor((now + BAGHDAD_MS) / 86_400_000) * 86_400_000 - BAGHDAD_MS; // local midnight, as UTC ms
  /** A local hour for a food order: lunch and dinner peaks, open 10:00 to 01:30. */
  function hour() {
    const r = rand();
    const h = r < 0.35 ? 13.5 + normal() : r < 0.9 ? 20.5 + 1.5 * normal() : 10 + 15 * rand();
    return Math.min(25.5, Math.max(10, h));
  }
  const plan = [];
  let n = firstClone;
  customers.forEach((c, i) => {
    for (let k = 0; k < counts[i]; k++) {
      const day = 1 + Math.floor(rand() * DAYS);
      const at = todayLocal - day * 86_400_000 + Math.round(hour() * 3_600_000);
      const tpl = templates[Math.floor(rand() * templates.length)];
      plan.push({ n: n++, customer: c, tpl, shiftMs: at - new Date(tpl.placed_at).getTime() });
    }
  });

  // ── columns of each table ──
  const columns = {};
  for (const [table] of TABLES) {
    columns[table] = (
      await db.query(
        `SELECT column_name AS name, data_type AS type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
        [table],
      )
    ).rows;
  }

  const byTemplate = new Map();
  for (const p of plan) {
    if (!byTemplate.has(p.tpl.id)) byTemplate.set(p.tpl.id, []);
    byTemplate.get(p.tpl.id).push(p);
  }

  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  let made = 0;
  const started = Date.now();
  for (const [tplId, copies] of byTemplate) {
    const tpl = copies[0].tpl;
    const orderIds = [tplId];
    const tripIds = tpl.trips;
    // Every id the copy must renumber: the rows' own ids and the ledger's posting groups.
    const eventIds = (await db.query(`SELECT id FROM public.events WHERE ${TABLES.find((t) => t[0] === 'events')[1]}`, [orderIds, tripIds])).rows.map((r) => r.id);
    const ids = new Set();
    for (const [table, where] of TABLES) {
      const rows = (await db.query(`SELECT id FROM public.${table} WHERE (${where}) AND ${ALL_PARAMS}`, [orderIds, tripIds, eventIds])).rows;
      rows.forEach((r) => ids.add(r.id));
    }
    (await db.query(`SELECT DISTINCT posting_group_id AS id FROM public.ledger_events WHERE (order_id = ANY($1) OR trip_id = ANY($2)) AND posting_group_id IS NOT NULL`, [orderIds, tripIds])).rows.forEach((r) =>
      ids.add(r.id),
    );
    const idList = [...ids].filter((x) => x && x.length >= 8);
    const remap = (expr) => {
      let e = expr;
      for (const id of idList) e = `replace(${e}, ${lit(id)}, 'hist' || p.n || '_' || ${lit(id)})`;
      return `replace(${e}, ${lit(tpl.orderer_id)}, p.customer)`;
    };

    for (let at = 0; at < copies.length; at += CHUNK) {
      const chunk = copies.slice(at, at + CHUNK);
      await db.query('BEGIN');
      try {
        for (const [table, where] of TABLES) {
          const cols = columns[table];
          const exprs = cols.map(({ name, type }) => {
            const ref = `t."${name}"`;
            const key = `${table}.${name}`;
            if (CLEARED.has(key)) return 'NULL';
            if (table === 'eta_samples' && name === 'hour_bucket') {
              return `CASE WHEN t.started_at IS NULL THEN t.hour_bucket ELSE extract(hour FROM t.started_at + p.shift_ms * interval '1 millisecond' + interval '3 hours')::int END`;
            }
            if (type === 'text') {
              const r = remap(ref);
              return SUFFIXED.has(key) ? `CASE WHEN ${ref} IS NULL THEN NULL ELSE ${r} || ':hist' || p.n END` : r;
            }
            if (type === 'jsonb') return `pg_temp.hist_shift_iso(${remap(`${ref}::text`)}, p.shift_ms)::jsonb`;
            if (type.startsWith('timestamp')) return `${ref} + p.shift_ms * interval '1 millisecond'`;
            return ref;
          });
          await db.query(
            `INSERT INTO public.${table} (${cols.map((c) => `"${c.name}"`).join(', ')})
             SELECT ${exprs.join(', ')}
               FROM public.${table} t
              CROSS JOIN unnest($4::int[], $5::bigint[], $6::text[]) AS p(n, shift_ms, customer)
              WHERE (${where.replace(/\b(id|order_id|trip_id|aggregate_id|event_id|status)\b/g, 't.$1')}) AND ${ALL_PARAMS}`,
            [orderIds, tripIds, eventIds, chunk.map((c) => c.n), chunk.map((c) => c.shiftMs), chunk.map((c) => c.customer)],
          );
        }
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
      }
      made += chunk.length;
      if (made % 5000 < CHUNK) console.log(`load history: ${made} / ${toMake} orders (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  }

  // ── each courier's day ends: kitchens paid from his cash, the rest handed to ops ──
  const lo = firstClone;
  const hi = n - 1;
  const settle = await db.query(
    `WITH cl AS (
       SELECT l.*, substring(l.id from '^hist(\\d+)_')::int AS clone FROM public.ledger_events l
        WHERE l.id LIKE 'hist%' AND substring(l.id from '^hist(\\d+)_')::int BETWEEN $1 AND $2
     ), cash AS (
       SELECT order_id, substr(from_account, 6) AS courier,
              ((occurred_at + interval '3 hours')::date) AS day
         FROM cl WHERE type = 'cash_collected' AND from_account LIKE 'cash:%'
     ), merchant AS (
       SELECT order_id,
              max(CASE WHEN to_account LIKE 'merchant\\_cash:%' THEN substr(to_account, 15) END) AS org,
              sum(CASE WHEN to_account LIKE 'merchant\\_cash:%' THEN amount_iqd WHEN from_account LIKE 'merchant\\_cash:%' THEN -amount_iqd ELSE 0 END) AS net
         FROM cl GROUP BY order_id
     ), paid AS (
       SELECT c.courier, m.org, c.day, sum(m.net)::int AS amount
         FROM cash c JOIN merchant m USING (order_id) WHERE m.org IS NOT NULL GROUP BY 1, 2, 3 HAVING sum(m.net) > 0
     ), moves AS (
       SELECT substr(a, 6) AS courier, ((occurred_at + interval '3 hours')::date) AS day, sum(delta)::int AS net
         FROM (SELECT to_account AS a, amount_iqd AS delta, occurred_at FROM cl
               UNION ALL SELECT from_account, -amount_iqd, occurred_at FROM cl) x
        WHERE a LIKE 'cash:%' GROUP BY 1, 2
     ), ins_paid AS (
       INSERT INTO public.ledger_events (id, kind, type, amount_iqd, from_account, to_account, posting_group_id, idempotency_key, memo, occurred_at, recorded_at, created_at, updated_at)
       SELECT 'histpay_' || md5(courier || org || day || $1), 'money', 'merchant_paid_by_courier', amount, 'merchant_cash:' || org, 'cash:' || courier,
              'histpay_' || md5(courier || org || day || $1), 'load-history:paid:' || courier || ':' || org || ':' || day || ':' || $1, 'load history: nightly hand-over',
              day + interval '23 hours 30 minutes' - interval '3 hours', now(), now(), now()
         FROM paid
       ON CONFLICT DO NOTHING
       RETURNING to_account, amount_iqd, occurred_at
     )
     SELECT m.courier, m.day, m.net + coalesce((SELECT sum(amount) FROM paid p WHERE p.courier = m.courier AND p.day = m.day), 0) AS left
       FROM moves m`,
    [lo, hi],
  );
  const handed = settle.rows.filter((r) => Number(r.left) < 0);
  for (let at = 0; at < handed.length; at += 1000) {
    const s = handed.slice(at, at + 1000);
    await db.query(
      `INSERT INTO public.ledger_events (id, kind, type, amount_iqd, from_account, to_account, posting_group_id, idempotency_key, memo, occurred_at, recorded_at, created_at, updated_at)
       SELECT 'histset_' || md5(c || d::text || $4), 'money', 'driver_settlement', a, 'bank', 'cash:' || c, 'histset_' || md5(c || d::text || $4),
              'load-history:settle:' || c || ':' || d || ':' || $4, 'load history: nightly cash to ops', d + interval '23 hours 45 minutes' - interval '3 hours', now(), now(), now()
         FROM unnest($1::text[], $2::date[], $3::int[]) AS t(c, d, a)
       ON CONFLICT DO NOTHING`,
      [s.map((r) => r.courier), s.map((r) => r.day), s.map((r) => -Number(r.left)), lo],
    );
  }

  const size = (await db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)).rows[0].s;
  console.log(
    `load history: ${made} orders copied from ${templates.length} templates over ${DAYS} days for ${customers.length} customers ` +
      `(${done + made} in all), ${handed.length} courier-days settled; database ${size}; ${Math.round((Date.now() - started) / 1000)} s`,
  );
} finally {
  await db.end();
}
