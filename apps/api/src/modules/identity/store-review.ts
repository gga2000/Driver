import { normalizeIraqiPhone } from './phone.js';

/**
 * The store-reviewer account (launch plan W5, BENCH-04, decision D-4). Google Play and Apple
 * reviewers sign in from outside Iraq and cannot receive an Iraqi code, so one number signs in with
 * a fixed code. Both live only in the host's secrets (`STORE_REVIEW_PHONE`, `STORE_REVIEW_CODE`),
 * never in code, docs or a PR: the repo is public. Always on while set (the stores re-review every
 * update), at most `STORE_REVIEW_DAILY_SIGNINS` sign-ins a day, every use alerted. No SMS or
 * WhatsApp ever goes to the number.
 */
export interface StoreReviewConfig {
  /** E.164. */
  phoneE164: string;
  code: string;
  dailySignIns: number;
}

export const STORE_REVIEW_DAILY_SIGNINS = 10;

/** Codes a person could guess first; refused so a careless secret cannot open the account. */
const WEAK_CODES = new Set(['000000', '111111', '123456', '654321', '121212', '112233', '999999', '123123']);

/** A fixed code from the host's secrets that is an obvious first guess (also used by `staging-test.ts`). */
export function isWeakFixedCode(code: string): boolean {
  return WEAK_CODES.has(code) || /^(\d)\1{5}$/.test(code);
}

/**
 * Both set → on; both unset → off; one without the other, a malformed number, or a code that is not
 * 6 digits or is an obvious one stops the boot (a half-configured reviewer path is a review failure
 * waiting to happen).
 */
export function storeReviewFromEnv(env: Record<string, string | undefined> = process.env): StoreReviewConfig | null {
  const phone = env['STORE_REVIEW_PHONE']?.trim() ?? '';
  const code = env['STORE_REVIEW_CODE']?.trim() ?? '';
  if (!phone && !code) return null;
  if (!phone || !code) throw new Error('STORE_REVIEW_PHONE and STORE_REVIEW_CODE must be set together; refusing to boot');
  if (!/^\d{6}$/.test(code)) throw new Error('STORE_REVIEW_CODE must be 6 digits; refusing to boot');
  if (isWeakFixedCode(code)) throw new Error('STORE_REVIEW_CODE is too easy to guess; refusing to boot');
  let phoneE164: string;
  try {
    phoneE164 = normalizeIraqiPhone(phone);
  } catch {
    throw new Error('STORE_REVIEW_PHONE is not an Iraqi mobile number; refusing to boot');
  }
  const raw = env['STORE_REVIEW_DAILY_SIGNINS'];
  const dailySignIns = raw ? Number(raw) : STORE_REVIEW_DAILY_SIGNINS;
  if (!Number.isInteger(dailySignIns) || dailySignIns < 1) throw new Error(`STORE_REVIEW_DAILY_SIGNINS must be a positive integer, got "${raw}"`);
  return { phoneE164, code, dailySignIns };
}

/** The event every reviewer sign-in writes (ops are alerted on it; it carries no number). */
export const STORE_REVIEW_SIGNIN_EVENT = 'security.store_review_signin';
