import { isUpdateRequiredError } from '@driver/contracts';
import { classifyError, type ErrorClass } from '@driver/contracts/net-client';

export { classifyError, type ErrorClass };

/**
 * The customer app's one answer to "should we try that again?" (audit pattern
 * `transient_error_treated_as_final`): only no response, our server failing and a short rate limit are
 * worth another go; a definitive answer (not found, forbidden, a rule said no, a refused session) is
 * shown at once instead of after two silent retries (CORE-16).
 */

export const RETRY_RULES = {
  /** Automatic tries after the first failure, for a query whose error is transient. */
  queryRetries: 3,
  /** Backoff before retry n (React Query counts failures from 0): base × 2^n, capped, ±20 % jitter. */
  backoffBaseMs: 1_000,
  backoffMaxMs: 10_000,
  /** A rate limit asking for a longer wait than this is shown, not waited out behind a skeleton. */
  maxRetryAfterSec: 10,
} as const;

/** React Query `retry` for queries: transient errors only, and a rate limit only when its wait is short. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (failureCount >= RETRY_RULES.queryRetries) return false;
  // CORE-05: an old build is refused on every call; the «حدّث التطبيق» screen takes over instead.
  if (isUpdateRequiredError(err)) return false;
  const c = classifyError(err);
  if (!c.transient) return false;
  if (c.kind === 'busy') return c.retryAfterSec !== null && c.retryAfterSec <= RETRY_RULES.maxRetryAfterSec;
  return true;
}

/** React Query `retryDelay`: the server's `retryAfterSec` when it gave one, else exponential backoff. */
export function retryDelayMs(failureCount: number, err: unknown, random: () => number = Math.random): number {
  const c = classifyError(err);
  if (c.kind === 'busy' && c.retryAfterSec !== null) return c.retryAfterSec * 1000;
  const raw = Math.min(RETRY_RULES.backoffMaxMs, RETRY_RULES.backoffBaseMs * 2 ** Math.max(0, failureCount));
  return Math.round(raw * (0.8 + 0.4 * random()));
}

/** Codes a public page (SOS contact, family share) reads as "this link is over". */
const LINK_GONE = new Set(['share_link_invalid', 'not_found']);

/**
 * A public page's failed read (audit FLOW-06, FLOW-07): `invalid` (the link is over: say so), `final`
 * (another definitive answer: show its words), or `transient` (no response, our server): keep what is
 * on screen, mark it as old and keep trying. "Ended" or "expired" never comes from a network blip.
 */
export function publicPageFailure(err: unknown): 'invalid' | 'final' | 'transient' {
  const c = classifyError(err);
  if (c.transient) return 'transient';
  return c.code !== null && LINK_GONE.has(c.code) ? 'invalid' : 'final';
}
