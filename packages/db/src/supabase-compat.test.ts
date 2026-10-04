import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static checks that every migration can run on Supabase (docs/deploy/supabase.md), where
 * `prisma migrate deploy` connects as `postgres`: a powerful role, but not a superuser, and the
 * `vault` schema belongs to Supabase's own supabase_vault extension.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../prisma/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((d) => /^\d{14}_/.test(d))
  .sort()
  .map((d) => ({ name: d, sql: readFileSync(resolve(migrationsDir, d, 'migration.sql'), 'utf8') }));

/** SQL with `--` comments removed, so a comment that names a statement does not count. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** Extensions a Supabase project offers (Database → Extensions) that we may create. */
const SUPABASE_EXTENSIONS = ['postgis', 'pgcrypto', 'uuid-ossp', 'pg_trgm', 'btree_gist', 'citext', 'unaccent', 'pg_stat_statements'];

describe('migrations run on Supabase', () => {
  it('every table created after the hardening migration is locked down by a later driver_harden call', () => {
    const hardenAt = migrations.findIndex((m) => m.name.endsWith('_supabase_hardening'));
    expect(hardenAt).toBeGreaterThanOrEqual(0);
    const harden = /driver_harden"?\s*\(/;
    let lastCreate = -1;
    let lastHarden = hardenAt;
    migrations.forEach((m, i) => {
      if (i <= hardenAt) return;
      if (/\bCREATE\s+TABLE\b/i.test(code(m.sql))) lastCreate = i;
      if (harden.test(code(m.sql))) lastHarden = i;
    });
    expect(lastHarden, `add SELECT * FROM "public"."driver_harden"(...) after ${migrations[lastCreate]?.name}`).toBeGreaterThanOrEqual(lastCreate);
  });

  it('never create tables or anything else in the `vault` schema (Supabase owns it)', () => {
    for (const m of migrations) {
      if (m.name.endsWith('_identity_vault_rename')) continue;
      expect(code(m.sql), m.name).not.toMatch(/"vault"\.|\bvault\.\w+\s*\(|CREATE SCHEMA[^;]*"?\bvault\b"?\s*;/i);
    }
  });

  it('use no superuser-only statements', () => {
    const forbidden = [
      /\bALTER\s+SYSTEM\b/i,
      /\b(CREATE|ALTER|DROP)\s+ROLE\b/i,
      /\b(CREATE|ALTER|DROP)\s+USER\b/i,
      /\bCREATE\s+EVENT\s+TRIGGER\b/i,
      /\bLANGUAGE\s+'?c'?\b/i,
      /\bCREATE\s+(TRUSTED\s+)?(PROCEDURAL\s+)?LANGUAGE\b/i,
      /\bCOPY\b[^;]*\bPROGRAM\b/i,
      /\bsession_replication_role\b/i,
      /\b(CREATE|ALTER|DROP)\s+DATABASE\b/i,
      /\bCREATE\s+TABLESPACE\b/i,
      /\bpg_read_server_files\b|\bpg_write_server_files\b/i,
    ];
    for (const m of migrations) for (const re of forbidden) expect(code(m.sql), `${m.name} ${re}`).not.toMatch(re);
  });

  it('create only extensions Supabase offers, idempotently', () => {
    for (const m of migrations) {
      for (const match of code(m.sql).matchAll(/CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?/gi)) {
        expect(match[1], `${m.name}: CREATE EXTENSION ${match[2]} needs IF NOT EXISTS`).toBeTruthy();
        expect(SUPABASE_EXTENSIONS, `${m.name}: ${match[2]}`).toContain(match[2]);
      }
    }
  });

  it('end with the hardening that enables RLS and closes the identity vault', () => {
    const hardening = migrations.find((m) => m.name.endsWith('_supabase_hardening'));
    expect(hardening).toBeDefined();
    const sql = code(hardening!.sql);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA %I FROM %s/);
    expect(sql).toMatch(/'anon', 'authenticated', 'service_role'/);
    expect(sql).toMatch(/SELECT \* FROM "public"\."driver_harden"\(ARRAY\['public', 'identity_vault'\], 'identity_vault'\)/);
    // The rename runs first, so an old `vault` schema has moved before the vault is locked.
    const names = migrations.map((m) => m.name);
    expect(names.findIndex((n) => n.endsWith('_identity_vault_rename'))).toBeLessThan(names.indexOf(hardening!.name));
  });
});
