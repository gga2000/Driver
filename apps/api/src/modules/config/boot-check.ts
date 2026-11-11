import { publicHttpsProblem } from '../../shared/public-url.js';
import { smsProviderName } from '../../shared/messaging/sms.js';
import { processRoleFromEnv, runsJobs } from '../../shared/process-role.js';
import { staffTotpKeyProblem } from '../../shared/secrets.js';

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
 * Addresses we put in messages: public https wherever set; `required` ones stop production when unset
 * (staging warns), the others only warn. Receipt links are optional: no page serves them yet, and
 * unset the receipt says «تلگاه بالتطبيق».
 */
const LINK_SETTINGS: ReadonlyArray<{ name: string; unset: string; required: boolean }> = [
  { name: 'CONSOLE_BASE_URL', unset: "CONSOLE_BASE_URL is not set: staff alerts would carry no Console link (set it to the company's own Console address)", required: true },
  { name: 'SAFETY_LINK_BASE_URL', unset: "SAFETY_LINK_BASE_URL is not set: an SOS emergency contact would get no live-location link (set it to the company's own /sos/ page)", required: true },
  { name: 'SHARE_LINK_BASE_URL', unset: "SHARE_LINK_BASE_URL is not set: trip-share and phone-booking messages would carry no trip link (set it to the company's own customer web address)", required: true },
  { name: 'NOTIFY_RECEIPT_BASE_URL', unset: 'NOTIFY_RECEIPT_BASE_URL is not set: WhatsApp receipts say «تلگاه بالتطبيق» instead of a link (fine until a receipt page exists)', required: false },
];

/**
 * SEC-16: configuration a deployed API must have, checked once at boot. Only missing or wrong
 * configuration stops boot: a dependency that is configured but unreachable never does (it shows in
 * `health.ready`, and `health.live` covers the database).
 *
 * - Staging and production need a database and Redis (without Redis no job, timer or outbox runs),
 *   and their own STAFF_TOTP_KEY (admin and finance sign-in's authenticator secrets), never the demo
 *   code switch STAFF_TOTP_DEMO.
 * - Production also needs a real SMS provider (or nobody can sign in) and must not carry the staging
 *   test code. (Expo push on production is checked where push is built, lane D's OPS-02 in
 *   `notify/providers/push.ts`, with the same production/staging rule.)
 * - Links we send only point at the company's own addresses: production needs `CONSOLE_BASE_URL`
 *   (staff alerts), `SAFETY_LINK_BASE_URL` (the SOS emergency contact's page) and `SHARE_LINK_BASE_URL`
 *   (trip-share and phone-booking links); staging only warns without them, and `NOTIFY_RECEIPT_BASE_URL`
 *   (receipts) only ever warns (`bootConfigWarnings`). Wherever set, each must be a public https address, not this
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
  // The launch scope comes from the city file on every deployed server, staging included (game day checks it).
  // Admin and finance sign-in's authenticator step seals its secrets with this key (docs/api/staff-totp.md).
  const totpKey = staffTotpKeyProblem(env);
  if (totpKey) problems.push(totpKey);
  if (env['STAFF_TOTP_DEMO']?.trim()) problems.push('STAFF_TOTP_DEMO is for the local demo only: remove it (fly secrets unset STAFF_TOTP_DEMO)');
  if (env['DRIVER_TEST_LAUNCHED_VERTICALS']?.trim()) problems.push('DRIVER_TEST_LAUNCHED_VERTICALS is for local runs and CI only: remove it (open a service in its city file instead)');
  if (where === 'production') {
    if (!env['SMS_PROVIDER']?.trim() || smsProviderName(env) === 'dev') problems.push('SMS_PROVIDER must be a real provider (otpiq, http or twilio): with dev nobody gets a sign-in code');
    if (env['STAGING_TEST_OTP']) problems.push('STAGING_TEST_OTP is set outside staging: remove it (fly secrets unset STAGING_TEST_OTP)');
  }
  for (const { name, unset, required } of LINK_SETTINGS) {
    const value = env[name]?.trim();
    if (value) {
      const problem = publicHttpsProblem(name, value);
      if (problem) problems.push(problem);
    } else if (where === 'production' && required) problems.push(unset);
  }
  return problems;
}

/**
 * Configuration a deployed API should have but can run without, logged once at boot as a warning.
 *
 * - A process that runs jobs (DRIVER_ROLE all or worker) without `TIMERS_SWEEPER=on`: the durable
 *   timers (a booked ride's T−30 search, a departure's start) then fire from their Redis job only, so a
 *   lost Redis job is never fired. deploy/fly/api.toml sets it on for staging and production.
 * - A message address left unset (LINK_SETTINGS): staging may run without any; production only without
 *   the optional ones.
 */
export function bootConfigWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const where = deployEnvironmentFromEnv(env);
  if (where === 'local') return [];
  const warnings: string[] = [];
  let jobs = true;
  try {
    jobs = runsJobs(processRoleFromEnv(env));
  } catch {
    // A bad DRIVER_ROLE stops boot where the role is read; count the process as running jobs here.
  }
  if (jobs && (env['TIMERS_SWEEPER'] ?? '').trim().toLowerCase() !== 'on') {
    warnings.push('TIMERS_SWEEPER is not on: durable timers fire only from Redis, so a lost Redis job never fires (set TIMERS_SWEEPER=on, deploy/fly/api.toml)');
  }
  for (const { name, required, unset } of LINK_SETTINGS) {
    if (!env[name]?.trim() && (where === 'staging' || !required)) warnings.push(unset);
  }
  return warnings;
}

/** Throws with the whole list when `bootConfigProblems` finds any. */
export function assertBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = bootConfigProblems(env);
  if (problems.length === 0) return;
  const where = deployEnvironmentFromEnv(env);
  throw new Error(`refusing to boot (${where}): ${problems.join('; ')} — docs/deploy/hosting.md lists every variable`);
}
