import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * Migration integration test (plan Step 1): deploys the hand-maintained migration on an empty
 * schema and checks what Prisma cannot express — PostGIS, the vault schema, GIST indexes, the
 * partitioned trail and the append-only ledger trigger.
 *
 * Needs a real Postgres+PostGIS: set DATABASE_URL (see .env.example, `pnpm db:up`). Skipped otherwise.
 * It runs inside its own throwaway schema pair so it never touches developer data.
 */
const url = process.env['DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../prisma/migrations');

describe.skipIf(!url)('migration 20261002000000_m2_domain (needs DATABASE_URL)', () => {
  const client = new pg.Client({ connectionString: url });
  const suffix = `mt_${Date.now().toString(36)}`;

  beforeAll(async () => {
    await client.connect();
    // Isolate: run the migration with public/vault renamed to throwaway schemas.
    const dirs = readdirSync(migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();
    await client.query(`CREATE SCHEMA "public_${suffix}"`);
    await client.query(`CREATE SCHEMA "vault_${suffix}"`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    for (const d of dirs) {
      const sql = readFileSync(resolve(migrationsDir, d, 'migration.sql'), 'utf8')
        .replace(/CREATE SCHEMA IF NOT EXISTS "vault";/g, '')
        .replace(/"public"\./g, `"public_${suffix}".`)
        .replace(/"vault"\./g, `"vault_${suffix}".`)
        .replace(/table_schema IN \('public', 'vault'\)/g, `table_schema IN ('public_${suffix}', 'vault_${suffix}')`);
      await client.query(sql);
    }
  }, 60_000);

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "public_${suffix}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "vault_${suffix}" CASCADE`);
    await client.end();
  });

  it('enables postgis', async () => {
    const r = await client.query(`SELECT extname FROM pg_extension WHERE extname = 'postgis'`);
    expect(r.rowCount).toBe(1);
  });

  it('creates the vault tables in their own schema', async () => {
    const r = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`,
      [`vault_${suffix}`],
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(['child_identities', 'person_identities', 'vault_access_logs']);
  });

  it('creates GIST indexes on geography columns', async () => {
    const r = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexdef LIKE '%USING gist%' ORDER BY 1`,
      [`public_${suffix}`],
    );
    const names = r.rows.map((x) => x.indexname as string);
    expect(names).toContain('zones_polygon_idx');
    expect(names).toContain('places_pin_idx');
    expect(names).toContain('meeting_points_pin_idx');
  });

  it('partitions trail_points monthly with a default partition', async () => {
    const r = await client.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace n ON n.oid = p.relnamespace
       WHERE p.relname = 'trail_points' AND n.nspname = $1 ORDER BY 1`,
      [`public_${suffix}`],
    );
    const parts = r.rows.map((x) => x.relname as string);
    expect(parts).toContain('trail_points_default');
    expect(parts.some((p) => /^trail_points_\d{4}_\d{2}$/.test(p))).toBe(true);
  });

  it('rejects UPDATE and DELETE on ledger_events', async () => {
    const t = `"public_${suffix}"."ledger_events"`;
    await client.query(
      `INSERT INTO ${t} (id, kind, type, amount_iqd, from_account, to_account, occurred_at, updated_at)
       VALUES ('le1', 'money', 'cash_collected', 1000, 'customer:c1', 'cash:d1', now(), now())`,
    );
    await expect(client.query(`UPDATE ${t} SET amount_iqd = 2000 WHERE id = 'le1'`)).rejects.toThrow(/append-only/);
    await expect(client.query(`DELETE FROM ${t} WHERE id = 'le1'`)).rejects.toThrow(/append-only/);
    const r = await client.query(`SELECT amount_iqd FROM ${t} WHERE id = 'le1'`);
    expect(r.rows[0].amount_iqd).toBe(1000);
  });

  it('accepts the Step 6 ledger types (migration 20261003000000_ledger_step6)', async () => {
    const t = `"public_${suffix}"."ledger_events"`;
    const types = ['service_fee', 'delivery_fee', 'fare', 'driver_incentive', 'driver_payout', 'rounding_residue'];
    for (const [i, type] of types.entries()) {
      await client.query(
        `INSERT INTO ${t} (id, kind, type, amount_iqd, from_account, to_account, occurred_at, updated_at)
         VALUES ($1, 'money', $2, 500, 'customer:c1', 'platform', now(), now())`,
        [`s6_${i}`, type],
      );
    }
    await client.query(
      `INSERT INTO ${t} (id, kind, type, amount_iqd, from_account, to_account, occurred_at, updated_at)
       VALUES ('s6_ref', 'points', 'referral_bonus', 200, 'points_pool', 'points:c1', now(), now())`,
    );
    const r = await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE id LIKE 's6_%'`);
    expect(r.rows[0].n).toBe(types.length + 1);
  });

  it('people has no PII columns', async () => {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'people'`,
      [`public_${suffix}`],
    );
    const cols = r.rows.map((x) => x.column_name as string);
    expect(cols).not.toContain('phone');
    expect(cols).not.toContain('name');
    expect(cols).not.toContain('phone_e164');
  });

  it('M2 follow-up: stops carry child_ref, never child_name; the name sits in vault.child_identities', async () => {
    const cols = async (schema: string, table: string) =>
      (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, table])).rows.map((x) => x.column_name as string);
    const stops = await cols(`public_${suffix}`, 'stops');
    expect(stops).toContain('child_ref');
    expect(stops).not.toContain('child_name');
    expect(await cols(`vault_${suffix}`, 'child_identities')).toEqual(expect.arrayContaining(['id', 'guardian_id', 'name']));
    expect(await cols(`vault_${suffix}`, 'vault_access_logs')).toContain('child_ref');
  });
});
