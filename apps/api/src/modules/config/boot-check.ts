import { smsProviderName } from '../../shared/messaging/sms.js';

/** Where this process runs: `production` (real customers), `staging`, or `local` (not NODE_ENV=production). */
export type DeployEnvironment = 'production' | 'staging' | 'local';

/**
 * NODE_ENV=production is both staging and the real thing; `DEPLOY_ENVIRONMENT=staging` (set by the
 * Staging setup workflow) tells them apart. Unset counts as production, so a forgotten variable gets
 * the strict rules, never the loose ones.
 */
export function deployEnvironmentFromEnv(env: NodeJS.ProcessEnv = process.env): DeployEnvironment {
  if (env['NODE_ENV'] !== 'production') return 'local';
  return env['DEPLOY_ENVIRONMENT']?.trim().toLowerCase() === 'staging' ? 'staging' : 'production';
}

/**
 * SEC-16: configuration a deployed API must have, checked once at boot. Only missing or wrong
 * configuration stops boot: a dependency that is configured but unreachable never does (it shows in
 * `health.ready`, and `health.live` covers the database).
 *
 * - Staging and production need a database and Redis (without Redis no job, timer or outbox runs).
 * - Production also needs a real SMS provider (or nobody can sign in) and must not carry the staging
 *   test code. (Expo push on production is checked where push is built, lane D's OPS-02 in
 *   `notify/providers/push.ts`, with the same production/staging rule.)
 *
 * Returns every problem at once, so one failed deploy shows the whole list.
 */
export function bootConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const where = deployEnvironmentFromEnv(env);
  if (where === 'local') return [];
  const problems: string[] = [];
  if (!env['DATABASE_URL']?.trim()) problems.push('DATABASE_URL is not set');
  if (!env['REDIS_URL']?.trim()) problems.push('REDIS_URL is not set');
  if (where === 'production') {
    if (!env['SMS_PROVIDER']?.trim() || smsProviderName(env) === 'dev') problems.push('SMS_PROVIDER must be a real provider (otpiq, http or twilio): with dev nobody gets a sign-in code');
    if (env['STAGING_TEST_OTP']) problems.push('STAGING_TEST_OTP is set outside staging: remove it (fly secrets unset STAGING_TEST_OTP)');
  }
  return problems;
}

/** Throws with the whole list when `bootConfigProblems` finds any. */
export function assertBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = bootConfigProblems(env);
  if (problems.length === 0) return;
  const where = deployEnvironmentFromEnv(env);
  throw new Error(`refusing to boot (${where}): ${problems.join('; ')} — docs/deploy/hosting.md lists every variable`);
}
