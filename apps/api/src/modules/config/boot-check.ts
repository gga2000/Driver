import { publicHttpsProblem } from '../../shared/public-url.js';
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

/** Addresses we put in messages: required on production (staging warns), public https wherever set. */
const LINK_SETTINGS: ReadonlyArray<{ name: string; unset: string }> = [
  { name: 'CONSOLE_BASE_URL', unset: "CONSOLE_BASE_URL is not set: staff alerts would carry no Console link (set it to the company's own Console address)" },
  { name: 'SAFETY_LINK_BASE_URL', unset: "SAFETY_LINK_BASE_URL is not set: an SOS emergency contact would get no live-location link (set it to the company's own /sos/ page)" },
  { name: 'SHARE_LINK_BASE_URL', unset: "SHARE_LINK_BASE_URL is not set: trip-share and phone-booking messages would carry no trip link (set it to the company's own customer web address)" },
  { name: 'NOTIFY_RECEIPT_BASE_URL', unset: "NOTIFY_RECEIPT_BASE_URL is not set: WhatsApp receipts would carry no receipt link (set it to the company's own receipt page)" },
];

/**
 * SEC-16: configuration a deployed API must have, checked once at boot. Only missing or wrong
 * configuration stops boot: a dependency that is configured but unreachable never does (it shows in
 * `health.ready`, and `health.live` covers the database).
 *
 * - Staging and production need a database and Redis (without Redis no job, timer or outbox runs).
 * - Production also needs a real SMS provider (or nobody can sign in) and must not carry the staging
 *   test code. (Expo push on production is checked where push is built, lane D's OPS-02 in
 *   `notify/providers/push.ts`, with the same production/staging rule.)
 * - Links we send only point at the company's own addresses: production needs `CONSOLE_BASE_URL`
 *   (staff alerts), `SAFETY_LINK_BASE_URL` (the SOS emergency contact's page), `SHARE_LINK_BASE_URL`
 *   (trip-share and phone-booking links) and `NOTIFY_RECEIPT_BASE_URL` (receipts); staging only warns
 *   without them (`bootConfigWarnings`). Wherever set, each must be a public https address, not this
 *   computer or a private network.
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
  for (const { name, unset } of LINK_SETTINGS) {
    const value = env[name]?.trim();
    if (value) {
      const problem = publicHttpsProblem(name, value);
      if (problem) problems.push(problem);
    } else if (where === 'production') problems.push(unset);
  }
  return problems;
}

/** What a deployed API may run without but should not: logged at boot, never stops it. */
export function bootConfigWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (deployEnvironmentFromEnv(env) !== 'staging') return [];
  return LINK_SETTINGS.filter(({ name }) => !env[name]?.trim()).map(({ unset }) => unset);
}

/** Throws with the whole list when `bootConfigProblems` finds any. */
export function assertBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = bootConfigProblems(env);
  if (problems.length === 0) return;
  const where = deployEnvironmentFromEnv(env);
  throw new Error(`refusing to boot (${where}): ${problems.join('; ')} — docs/deploy/hosting.md lists every variable`);
}
