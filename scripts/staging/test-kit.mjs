#!/usr/bin/env node
// Driver (درايفر) — STAGING ONLY: give the staging test numbers the partner and restaurant roles a
// one-person test needs (docs/launch/staging-test-kit.md). Run by Actions → Staging test kit.
//
//   DIRECT_URL=… DATABASE_CA_CERT=… KIT_ENVIRONMENT=staging node scripts/staging/test-kit.mjs [--undo]
//
// No screen grants a courier, driver or restaurant-owner role yet (that is an admin API call), so a
// tester on staging could never be anything but a customer. This kit does it for three fixed numbers in
// the staging test range (0770 000 0100–0199, never staff, docs/api/staging-test-numbers.md):
//
//   0770 000 0150  owner of the four seeded Aziziyah restaurants
//   0770 000 0151  courier + taxi driver, a white Hyundai Elantra (food and taxi offers)
//   0770 000 0152  courier + tuktuk driver, a Bajaj tuktuk (food, errands, parcels and tuktuk offers)
//
// Each number must have signed in once first (the person row is made at sign-in with the API's phone
// pepper, which only the API holds); a number that hasn't is listed and skipped. Idempotent: run it again
// any time. `--undo` revokes exactly what the kit grants and parks its two vehicles.
// It refuses to run unless KIT_ENVIRONMENT=staging, and only ever touches numbers in the test range.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'packages/db/package.json'));

const RESTAURANTS = ['org_aziziyah_khalid', 'org_aziziyah_haj_kareem', 'org_aziziyah_sham', 'org_aziziyah_musafir'];

/** What the kit grants. Phones in E.164; every one must be in the staging test range. */
export const KIT = [
  { phone: '+9647700000150', label: 'restaurant owner', roles: RESTAURANTS.map((orgId) => ({ kind: 'merchant_owner', orgId })), vehicle: null },
  {
    phone: '+9647700000151',
    label: 'courier + taxi driver',
    roles: [{ kind: 'courier', orgId: null }, { kind: 'driver', orgId: null }],
    vehicle: { plate: 'TEST-151', class: 'car', model: 'Hyundai Elantra', colour: 'white' },
  },
  {
    phone: '+9647700000152',
    label: 'courier + tuktuk driver',
    roles: [{ kind: 'courier', orgId: null }, { kind: 'driver', orgId: null }],
    vehicle: { plate: 'TEST-152', class: 'tuktuk', model: 'Bajaj', colour: 'red' },
  },
];

/** The staging test range: +96477000001xx (docs/api/staging-test-numbers.md). */
export function inTestRange(e164) {
  return /^\+96477000001\d\d$/.test(e164);
}

const newId = () => `kit${randomBytes(11).toString('hex')}`;

function caCert() {
  const pem = process.env.DATABASE_CA_CERT?.trim();
  if (!pem) return undefined;
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

function pgConfig(url) {
  const ca = caCert();
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}

const show = (e164) => `0${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`;

async function grant(db, personId, { kind, orgId }) {
  const found = await db.query(
    'SELECT id, revoked_at FROM public.roles WHERE person_id = $1 AND kind = $2::"public"."RoleKind" AND org_id IS NOT DISTINCT FROM $3',
    [personId, kind, orgId],
  );
  if (found.rows.length === 0) {
    await db.query(
      'INSERT INTO public.roles (id, person_id, kind, org_id, created_at, updated_at) VALUES ($1, $2, $3::"public"."RoleKind", $4, now(), now())',
      [newId(), personId, kind, orgId],
    );
    return 'granted';
  }
  if (found.rows.some((r) => r.revoked_at === null)) return 'already';
  await db.query('UPDATE public.roles SET revoked_at = NULL, frozen_at = NULL, updated_at = now() WHERE id = $1', [found.rows[0].id]);
  return 'restored';
}

async function revoke(db, personId, { kind, orgId }) {
  const r = await db.query(
    'UPDATE public.roles SET revoked_at = now(), updated_at = now() WHERE person_id = $1 AND kind = $2::"public"."RoleKind" AND org_id IS NOT DISTINCT FROM $3 AND revoked_at IS NULL',
    [personId, kind, orgId],
  );
  return r.rowCount > 0 ? 'revoked' : 'none';
}

async function main() {
  const undo = process.argv.includes('--undo');
  if (process.env.KIT_ENVIRONMENT !== 'staging') {
    console.error('Refused: the test kit only runs on staging (KIT_ENVIRONMENT=staging).');
    process.exit(1);
  }
  for (const k of KIT) if (!inTestRange(k.phone)) throw new Error(`not a staging test number: ${k.phone}`);
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_URL is not set.');
    process.exit(1);
  }
  if (!existsSync(resolve(root, 'packages/db/node_modules/pg'))) {
    console.error('Dependencies are missing: run `pnpm install --filter=@driver/db...` first.');
    process.exit(1);
  }
  const pg = require('pg');
  const db = new pg.Client({ ...pgConfig(url), connectionTimeoutMillis: 15_000 });
  await db.connect();

  const lines = [];
  let missing = 0;
  try {
    const orgs = await db.query('SELECT id FROM public.orgs WHERE id = ANY($1)', [RESTAURANTS]);
    const haveOrg = new Set(orgs.rows.map((r) => r.id));
    for (const k of KIT) {
      const who = await db.query('SELECT person_id FROM identity_vault.person_identities WHERE phone_e164 = $1', [k.phone]);
      const personId = who.rows[0]?.person_id;
      if (!personId) {
        missing += 1;
        lines.push(`| ${show(k.phone)} | ${k.label} | not signed in yet: sign in once with this number, then run the kit again |`);
        continue;
      }
      const done = [];
      await db.query('BEGIN');
      try {
        for (const role of k.roles) {
          if (role.orgId && !haveOrg.has(role.orgId)) {
            done.push(`${role.orgId}: restaurant missing (run Staging setup)`);
            continue;
          }
          const what = undo ? await revoke(db, personId, role) : await grant(db, personId, role);
          done.push(`${role.kind}${role.orgId ? ` @ ${role.orgId.replace('org_aziziyah_', '')}` : ''}: ${what}`);
        }
        if (k.vehicle) {
          const v = k.vehicle;
          if (undo) {
            await db.query('UPDATE public.vehicles SET active = false, active_driver_id = NULL, updated_at = now() WHERE plate = $1', [v.plate]);
            done.push(`${v.plate}: parked`);
          } else {
            await db.query(
              `INSERT INTO public.vehicles (id, plate, class, owner_org_id, active_driver_id, active, review_state, model, colour, created_at, updated_at)
               VALUES ($1, $2, $3::"public"."VehicleClass", NULL, $4, true, 'verified', $5, $6, now(), now())
               ON CONFLICT (plate) DO UPDATE SET class = EXCLUDED.class, active_driver_id = EXCLUDED.active_driver_id, active = true,
                 review_state = 'verified', model = EXCLUDED.model, colour = EXCLUDED.colour, updated_at = now()`,
              [newId(), v.plate, v.class, personId, v.model, v.colour],
            );
            done.push(`${v.plate} (${v.class}): on`);
          }
        }
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
      lines.push(`| ${show(k.phone)} | ${k.label} | ${done.join('; ')} |`);
    }
  } finally {
    await db.end();
  }

  const out = [
    `### Staging test kit ${undo ? '(undo)' : ''}`,
    '',
    '| Number | Is | What the kit did |',
    '| --- | --- | --- |',
    ...lines,
    '',
    missing > 0
      ? `${missing} number(s) have not signed in yet. Sign in once with each, then run this again.`
      : 'Done. Sign out and back in on each app (or wait 30 seconds and reopen it) to pick up the new roles.',
  ].join('\n');
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
}

main().catch((err) => {
  console.error(`Test kit failed: ${err?.message ?? err}`);
  process.exit(1);
});
