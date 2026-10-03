import type { DriverPinState } from '@driver/contracts';
import type { DispatchDriverState } from '../dispatch/index.js';

/**
 * The map state once cash caps are known (money §4: over cap = finish the current job, no new
 * offers). A driver on a job stays `on_job` (he is still carrying it) and a silent one stays
 * `offline_recent`; a free or offered driver who is over cap shows `over_cap`, because dispatch
 * will not send him anything new until he settles.
 */
export function pinState(base: DispatchDriverState, overCap: boolean): DriverPinState {
  if (overCap && (base === 'free' || base === 'offered')) return 'over_cap';
  return base;
}

/** The ledger's `cash:` balance is negative while he holds cash; the Console shows what he holds. */
export function cashHeld(cashBalanceIqd: number): number {
  return Math.max(0, -cashBalanceIqd);
}

/** One hour back from `now` (right-now bar windows). */
export function hourBefore(now: Date): Date {
  return new Date(now.getTime() - 60 * 60_000);
}
