/**
 * Vitest globalSetup for every `integration` project (apps/api, packages/db). See docs/ci.md.
 *
 * Integration suites are written with `describe.skipIf(!process.env.DATABASE_URL)` (or REDIS_URL), so a
 * laptop without `pnpm db:up` gets a clean, fully skipped run. In CI a missing service must never turn
 * into a silent green: when `CI` is set and either URL is absent, fail before any test runs.
 */
const REQUIRED = ['DATABASE_URL', 'REDIS_URL'] as const;

export default function setup(): void {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length === 0) return;
  const ci = Boolean(process.env['CI']) && process.env['CI'] !== 'false';
  const message = `integration tests: ${missing.join(', ')} not set`;
  if (ci) throw new Error(`${message} — CI must run them against the Postgres/Redis services`);
  console.warn(
    `${message}; suites that need them will be skipped (run \`pnpm db:up\`, see docs/ci.md).`,
  );
}
