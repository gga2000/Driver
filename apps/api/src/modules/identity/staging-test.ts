import type { RoleKind } from '@driver/contracts';
import { isWeakFixedCode } from './store-review.js';

/**
 * Staging test numbers (docs/api/staging-test-numbers.md). Staging has no SMS gateway, so a small
 * range of numbers, 0770 000 0100 to 0770 000 0199, signs in with one fixed code from the host's
 * secret `STAGING_TEST_OTP`. The code lives only in that secret, never in code, docs or a PR: the
 * repo is public. It works only on a host that says `DEPLOY_ENVIRONMENT=staging`, and never for a
 * person who holds a staff (Console) role. Nothing is ever texted to these numbers.
 */
export interface StagingTestConfig {
  code: string;
  /** Fixed codes a day across the whole range (`STAGING_TEST_DAILY_CODES`). */
  dailyCodes: number;
}

export const STAGING_TEST_DAILY_CODES = 200;

/** 0770 000 01xx in E.164. */
const STAGING_TEST_NUMBER = /^\+96477000001\d{2}$/;

/** The Console's roles: a test number never signs in as staff and is never made staff. */
export const STAFF_ROLES: readonly RoleKind[] = ['field_ops', 'dispatcher', 'support', 'finance', 'admin'];

/** Whether an E.164 number is in the staging test range (whether or not the range is switched on). */
export function isStagingTestNumber(phoneE164: string): boolean {
  return STAGING_TEST_NUMBER.test(phoneE164);
}

/**
 * Unset → off. Set on a host that is not staging, not 6 digits, or an obvious code → the boot stops:
 * a fixed code that leaked into production settings must never open an account.
 */
export function stagingTestFromEnv(env: Record<string, string | undefined> = process.env): StagingTestConfig | null {
  const code = env['STAGING_TEST_OTP']?.trim() ?? '';
  if (!code) return null;
  if (env['DEPLOY_ENVIRONMENT']?.trim() !== 'staging') throw new Error('STAGING_TEST_OTP is set on a host whose DEPLOY_ENVIRONMENT is not "staging"; refusing to boot');
  if (!/^\d{6}$/.test(code)) throw new Error('STAGING_TEST_OTP must be 6 digits; refusing to boot');
  if (isWeakFixedCode(code)) throw new Error('STAGING_TEST_OTP is too easy to guess; refusing to boot');
  const raw = env['STAGING_TEST_DAILY_CODES'];
  const dailyCodes = raw ? Number(raw) : STAGING_TEST_DAILY_CODES;
  if (!Number.isInteger(dailyCodes) || dailyCodes < 1) throw new Error(`STAGING_TEST_DAILY_CODES must be a positive integer, got "${raw}"`);
  return { code, dailyCodes };
}
