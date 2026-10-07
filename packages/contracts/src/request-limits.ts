/**
 * Request limits on every API call (launch plan W5: SEC-03, SCALE-20). Generous for a person using an
 * app, tight enough that a client stuck in a retry loop or a script cannot take the API from
 * everyone. Counted per one-minute window across every API machine.
 *
 * - `maxBatchSize`: calls one HTTP request may carry (the apps' links split well below it).
 * - `perPerson`: calls per signed-in person per minute, enforced.
 * - `perGuestIp`: calls per minute from one address without a sign-in. Alert-only at launch
 *   (`REQUEST_LIMIT_IP_MODE=enforce` turns it on): carrier NAT puts a whole town behind a few
 *   addresses (decision D-5). Sign-in (`identity.*`, which has its own guard) and health checks
 *   are not counted.
 * - `quotePerPerson` / `quotePerGuestIp`: `pricing.quote` keeps every quote it gives (LOAD-01), so it
 *   has its own lower limits, both enforced.
 */
export const REQUEST_LIMITS = {
  windowMs: 60_000,
  maxBatchSize: 50,
  /** What the apps' batch links send at most in one request (half the server's limit). */
  clientBatchItems: 25,
  perPerson: 600,
  perGuestIp: 1_200,
  quotePerPerson: 30,
  quotePerGuestIp: 300,
} as const;

/** One call as the limits see it. `personId` from a valid access token; `ip` as the proxy reports it. */
export interface RequestCall {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  personId: string | null;
  ip: string | null;
}

/** Counts each call; throws `rate_limited` (with `retryAfterSec`) when a limit is reached. */
export interface RequestLimitsPort {
  check(call: RequestCall): Promise<void>;
}
