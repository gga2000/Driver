import type { Order } from '@driver/contracts';

/** How often a booked-ahead order is asked about while its screen is open (the kitchen won't see it for hours). */
export const BOOKED_AHEAD_POLL_MS = 30_000;

/**
 * A food order booked for later that the kitchen hasn't been shown yet (FOOD-02). The server offers it
 * to the kitchen shortly before its time (prep + 10 min ahead), so until then there is no 90-second
 * answer to wait for: no ring, no "the kitchen is slow", no asking every 2 seconds.
 */
export function isBookedAhead(o: Pick<Order, 'state' | 'scheduledFor' | 'merchantOfferedAt'>, now: Date | number): boolean {
  if (o.state !== 'placed' || o.merchantOfferedAt || !o.scheduledFor) return false;
  return o.scheduledFor.getTime() > (typeof now === 'number' ? now : now.getTime());
}
