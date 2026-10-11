import type { CancelledOrder } from '@driver/contracts';

/**
 * «انلغى، لا تكمل»: an order the kitchen had accepted and that was then cancelled stays on the board
 * as a red card (from `merchant.board`'s `cancelled`, the last 15 minutes) until someone taps it away
 * on this device — it never just vanishes while the grill is going. Pure, so it is unit-tested.
 */
export const CANCELLED_SEEN_KEY = 'driver.merchant.cancelled-seen';

/** The red cards still to show, newest first. */
export function visibleCancelled(cancelled: readonly CancelledOrder[] | undefined, seen: ReadonlySet<string>): CancelledOrder[] {
  return (cancelled ?? []).filter((c) => !seen.has(c.orderId));
}
