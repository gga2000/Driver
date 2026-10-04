#!/usr/bin/env node
// Driver (درايفر) — set up and verify the production database on Supabase (docs/deploy/supabase.md).
//
//   DATABASE_URL=… DIRECT_URL=… PHONE_HASH_PEPPER=… SEED_ADMIN_PHONE=07xx… node scripts/deploy/supabase-setup.mjs
//
// Steps: preflight → `prisma migrate deploy` (over DIRECT_URL) → harden (RLS + revokes, trail partitions)
// → production seed → verify → checklist. Every step is idempotent: run it again after each deploy.
//
// Flags:
//   --verify-only   no writes at all: only the checks and the checklist (the deploy workflow uses this)
//   --skip-migrate  do not run `prisma migrate deploy` (migrations applied some other way)
//   --skip-seed     do not run the seed
//   --dev-seed      seed the development profile (demo restaurant + demo dispatcher) — never in production
//
// Env: DATABASE_URL (pooled, what the API uses), DIRECT_URL (direct/session connection, for migrations;
// defaults to DATABASE_URL), DATABASE_CA_CERT (optional PEM; verifies TLS), PHONE_HASH_PEPPER and
// SEED_ADMIN_PHONE / SEED_ADMIN_NAME (optional first admin). Exit code 1 when any check fails.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = resolve(root, 'packages/db/prisma/migrations');
const require = createRequire(resolve(root, 'packages/db/package.json'));

const args = new Set(process.argv.slice(2));
const VERIFY_ONLY = args.has('--verify-only');
const SKIP_MIGRATE = VERIFY_ONLY || args.has('--skip-migrate');
const SKIP_SEED = VERIFY_ONLY || args.has('--skip-seed');
const DEV_SEED = args.has('--dev-seed');
const APP_SCHEMAS = ['public', 'identity_vault'];
const VAULT = 'identity_vault';

const results = [];
const ok = (label, detail = '') => results.push({ pass: true, label, detail });
const bad = (label, detail = '') => results.push({ pass: false, label, detail });
const warn = (msg) => console.log(`  ! ${msg}`);
const step = (msg) => console.log(`\n── ${msg}`);

/** postgresql://user:secret@host:port/db?x → postgresql://user:•••@host:port/db?x */
function mask(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '•••';
    return u.toString();
  } catch {
    return '(not a URL)';
  }
}

function caCert() {
  const pem = process.env.DATABASE_CA_CERT?.trim();
  if (!pem) return undefined;
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

/** Same rules as @driver/db pgPoolConfig: with a CA, verify against it and drop sslmode from the URL. */
function pgConfig(url) {
  const ca = caCert();
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

async function connect(pg, url, label) {
  const client = new pg.Client({ ...pgConfig(url), connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    return client;
  } catch (err) {
    const msg = err?.message ?? String(err);
    bad(`connect (${label})`, msg);
    if (/certificate|self[- ]signed|SSL/i.test(msg)) {
      warn('TLS problem: paste Supabase\'s CA certificate into DATABASE_CA_CERT (docs/deploy/supabase.md, step 6),');
      warn('or, only to get unblocked, put ?sslmode=no-verify at the end of the URL (encrypted, not verified).');
    }
    if (/password authentication failed|Tenant or user not found/i.test(msg)) {
      warn('Wrong password or user. On the pooler the user is postgres.<project-ref>, not just postgres.');
    }
    return null;
  }
}

function run(cmd, cmdArgs, env) {
  console.log(`  $ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

function localMigrations() {
  return readdirSync(migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();
}

async function main() {
  console.log('Driver — Supabase database setup' + (VERIFY_ONLY ? ' (verify only)' : ''));
  const DATABASE_URL = process.env.DATABASE_URL;
  const DIRECT_URL = process.env.DIRECT_URL || DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('\nDATABASE_URL is not set. Copy both connection strings from Supabase (docs/deploy/supabase.md, step 4).');
    process.exit(1);
  }
  if (!existsSync(resolve(root, 'packages/db/node_modules/pg'))) {
    console.error('\nDependencies are missing: run `pnpm install` and `pnpm turbo run build --filter=@driver/db` first.');
    process.exit(1);
  }
  const pg = require('pg');

  // ── 1. Preflight ──────────────────────────────────────────────────────────────────────────────
  step('1. Preflight');
  console.log(`  DATABASE_URL (API, pooled) = ${mask(DATABASE_URL)}`);
  console.log(`  DIRECT_URL   (migrations)  = ${mask(DIRECT_URL)}${process.env.DIRECT_URL ? '' : '   (DIRECT_URL not set: using DATABASE_URL)'}`);
  const pooled = new URL(DATABASE_URL);
  const direct = new URL(DIRECT_URL);
  if (/pooler\.supabase\.com$/.test(pooled.hostname) && pooled.port !== '6543') warn('DATABASE_URL is the pooler but not port 6543 (transaction mode). The API wants 6543.');
  if (direct.port === '6543') bad('DIRECT_URL is not port 6543', 'transaction mode cannot run migrations: use the direct (db.<ref>.supabase.co) or session (port 5432) string');
  if (!caCert() && !/sslmode=/.test(DATABASE_URL)) warn('No DATABASE_CA_CERT and no sslmode in DATABASE_URL: the API would connect without TLS.');

  const db = await connect(pg, DIRECT_URL, 'DIRECT_URL');
  if (!db) return finish();
  const info = (await db.query(`SELECT current_user AS who, version() AS v, current_setting('server_version_num')::int AS num`)).rows[0];
  ok('connected (DIRECT_URL)', `${info.who} — ${String(info.v).split(',')[0]}`);
  if (info.num < 150000) warn('Postgres older than 15: Supabase projects are 15 or 17; check the project.');
  const supabase = (await db.query(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS s`)).rows[0].s;
  console.log(`  Supabase roles (anon, authenticated): ${supabase ? 'present' : 'absent (plain Postgres)'}`);

  const postgis = (await db.query(`SELECT extversion, extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'postgis'`)).rows[0];
  const migrated = (await db.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS m`)).rows[0].m;
  if (postgis && postgis.schema !== 'public' && !migrated) {
    bad('PostGIS is enabled in schema "' + postgis.schema + '"', 'our migrations create it in "public". In Supabase: Database → Extensions → postgis → turn it off, then run this again.');
    await db.end();
    return finish();
  }
  const oldVault = (await db.query(`SELECT to_regclass('"vault"."person_identities"') IS NOT NULL AS v`)).rows[0].v;
  if (oldVault) warn('Found our tables in the old `vault` schema: migration 20261004210000_identity_vault_rename moves them.');
  await db.end();

  // ── 2. Migrate ────────────────────────────────────────────────────────────────────────────────
  step('2. Migrations (prisma migrate deploy)');
  if (SKIP_MIGRATE) console.log('  skipped');
  else if (process.env.PRISMA_SCHEMA_ENGINE_BINARY === '/bin/true') {
    bad('migrate deploy', 'PRISMA_SCHEMA_ENGINE_BINARY=/bin/true turns migrations into a no-op: unset it (docs/ci.md, offline escape hatch)');
  } else if (run('pnpm', ['--filter', '@driver/db', 'exec', 'prisma', 'migrate', 'deploy'], { DIRECT_URL, DATABASE_URL: DIRECT_URL })) ok('migrate deploy');
  else bad('migrate deploy', 'see the Prisma output above');

  // ── 3. Harden ─────────────────────────────────────────────────────────────────────────────────
  const w = await connect(pg, DIRECT_URL, 'DIRECT_URL');
  if (!w) return finish();
  if (!VERIFY_ONLY) {
    step('3. Harden (RLS on, Supabase API roles revoked) and trail partitions');
    const hasFn = (await w.query(`SELECT to_regprocedure('public.driver_harden(text[], text)') IS NOT NULL AS f`)).rows[0].f;
    if (!hasFn) bad('harden', 'public.driver_harden is missing: migrations did not run');
    else {
      const changes = (await w.query(`SELECT * FROM public.driver_harden($1::text[], $2)`, [APP_SCHEMAS, VAULT])).rows;
      for (const c of changes.slice(0, 12)) console.log(`  · ${c.object}: ${c.action}`);
      if (changes.length > 12) console.log(`  · … ${changes.length - 12} more`);
      ok('harden', `${changes.length} change(s)`);
      await w.query(`SELECT public.ensure_trail_partition(date_trunc('month', now())::date), public.ensure_trail_partition((date_trunc('month', now()) + interval '1 month')::date)`);
    }
  }

  // ── 4. Seed ───────────────────────────────────────────────────────────────────────────────────
  step(`4. Seed (${DEV_SEED ? 'development' : 'production'} profile)`);
  if (SKIP_SEED) console.log('  skipped');
  else {
    const env = { DATABASE_URL: DIRECT_URL, SEED_PROFILE: DEV_SEED ? 'dev' : 'production' };
    if (process.env.SEED_ADMIN_PHONE && !process.env.PHONE_HASH_PEPPER) bad('seed', 'SEED_ADMIN_PHONE needs PHONE_HASH_PEPPER (the same value the API uses)');
    else if (run('pnpm', ['db:seed'], env)) ok('seed');
    else bad('seed', 'see the output above');
  }

  // ── 5. Verify ─────────────────────────────────────────────────────────────────────────────────
  step('5. Verify');
  await verify(w, supabase);
  await w.end();

  if (process.env.DIRECT_URL && DATABASE_URL !== DIRECT_URL) {
    const p = await connect(pg, DATABASE_URL, 'DATABASE_URL (pooled)');
    if (p) {
      const r = (await p.query(`SELECT 1 AS one`)).rows[0];
      if (r.one === 1) ok('API connection string works (DATABASE_URL)', pooled.port === '6543' ? 'pooler, transaction mode' : `port ${pooled.port || 5432}`);
      await p.end();
    }
  }
  return finish();
}

async function verify(db, supabase) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];

  const pgis = await one(`SELECT extversion, extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'postgis'`);
  if (pgis) {
    const full = await one(`SELECT postgis_lib_version() AS v`).catch(() => ({ v: pgis.extversion }));
    ok('PostGIS installed', `${full.v} in schema ${pgis.schema}`);
  } else bad('PostGIS installed', 'extension missing');

  const local = localMigrations();
  const hasTable = (await one(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS t`)).t;
  if (!hasTable) bad('migrations applied', 'no _prisma_migrations table');
  else {
    const rows = (await db.query(`SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations`)).rows;
    const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    const missing = local.filter((m) => !applied.has(m));
    if (failed.length) bad('migrations applied', `failed: ${failed.join(', ')} (docs/deploy/runbook.md → "A migration failed")`);
    else if (missing.length) bad('migrations applied', `not applied: ${missing.join(', ')}`);
    else ok('migrations applied', `${applied.size} of ${local.length}`);
  }

  const vaultTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`, [VAULT])).rows.map((r) => r.table_name);
  if (vaultTables.includes('person_identities')) ok('identity vault schema', `${VAULT}: ${vaultTables.join(', ')}`);
  else bad('identity vault schema', `${VAULT} has no person_identities`);

  const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') ORDER BY 1`)).rows.map((r) => r.rolname);
  const vaultLeaks = [];
  for (const role of ['public', ...roles]) {
    const r = await one(
      `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = $2 AND c.relkind IN ('r', 'p') AND has_table_privilege($1, c.oid, 'SELECT')) AS sel`,
      [role, VAULT],
    );
    if (r.usage || r.sel) vaultLeaks.push(role);
  }
  if (vaultLeaks.length) bad('identity vault closed', `readable by: ${vaultLeaks.join(', ')}`);
  else ok('identity vault closed', `no access for ${['PUBLIC', ...roles].join(', ')}`);

  const noRls = (
    await db.query(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY ($1) AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
       ORDER BY 1`,
      [APP_SCHEMAS],
    )
  ).rows.map((r) => r.t);
  if (noRls.length) bad('row level security on every table', `missing on: ${noRls.slice(0, 8).join(', ')}${noRls.length > 8 ? ', …' : ''} (run without --verify-only to fix)`);
  else ok('row level security on every table');

  if (supabase) {
    const readable = (
      await db.query(
        `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ANY ($1) AND c.relkind IN ('r', 'p', 'v', 'm')
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
           AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
         ORDER BY 1`,
        [APP_SCHEMAS],
      )
    ).rows.map((r) => r.t);
    if (readable.length) bad('Data API roles see no table', `anon/authenticated can select: ${readable.slice(0, 8).join(', ')}`);
    else ok('Data API roles see no table', 'anon and authenticated have no grants on our tables');
    const sbVault = await one(`SELECT to_regclass('vault.secrets') IS NOT NULL AS v`);
    if (sbVault.v) ok("Supabase's own vault untouched", 'vault.secrets present');
  }

  const parts = (
    await db.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace WHERE n.nspname = 'public' AND p.relname = 'trail_points' ORDER BY 1`,
    )
  ).rows.map((r) => r.relname);
  const month = (d) => `trail_points_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const want = ['trail_points_default', month(now)];
  const lacking = want.filter((p) => !parts.includes(p));
  if (lacking.length) bad('trail_points partitions', `missing ${lacking.join(', ')} (the API creates this and next month's at boot)`);
  else ok('trail_points partitions', parts.join(', '));

  const triggers = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('ledger_events_append_only', 'vault_access_logs_append_only') ORDER BY 1`)).rows.map((r) => r.tgname);
  if (triggers.length === 2) ok('append-only triggers', triggers.join(', '));
  else bad('append-only triggers', `found ${triggers.join(', ') || 'none'}`);

  const seed = await one(
    `SELECT (SELECT count(*)::int FROM public.cities) AS cities, (SELECT count(*)::int FROM public.zones) AS zones,
            (SELECT count(*)::int FROM public.orgs WHERE type IN ('restaurant', 'grocer') AND location_zone_key IS NOT NULL) AS merchants,
            (SELECT count(*)::int FROM public.people WHERE id = 'person_demo_dispatcher') AS demo,
            (SELECT count(*)::int FROM public.roles WHERE kind = 'admin' AND revoked_at IS NULL) AS admins`,
  ).catch(() => null);
  if (!seed) bad('seed data', 'tables missing');
  else {
    if (seed.cities >= 3 && seed.zones >= 34 && seed.merchants >= 4) ok('seed data', `${seed.cities} cities, ${seed.zones} zones, ${seed.merchants} orderable restaurants`);
    else bad('seed data', `${seed.cities} cities, ${seed.zones} zones, ${seed.merchants} restaurants — run without --skip-seed`);
    if (seed.demo && !DEV_SEED) bad('no demo dispatcher in production', 'person_demo_dispatcher exists: revoke its roles in the Console (docs/deploy/runbook.md)');
    if (seed.admins > 0) ok('an admin exists', `${seed.admins} admin role(s)`);
    else bad('an admin exists', 'set SEED_ADMIN_PHONE (your own mobile) and PHONE_HASH_PEPPER, then run again');
  }
}

function finish() {
  console.log('\n── Checklist');
  for (const r of results) console.log(`  ${r.pass ? '✔' : '✘'} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(
    failed
      ? `\n${failed} check(s) failed. Fix them (docs/deploy/supabase.md, "If something fails") and run this again.`
      : '\nDatabase ready. Next: docs/deploy/hosting.md (deploy the API with these same two URLs).',
  );
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('\nsetup crashed:', err);
  process.exit(1);
});
