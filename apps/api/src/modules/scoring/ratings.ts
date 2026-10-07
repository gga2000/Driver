import { COURIER_RATING_WINDOW, type Order, type Trip } from '@driver/contracts';

/** Scores older than this don't speak for him any more (and keep the read small). */
export const DELIVERY_RATING_LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;

/** Where a driver's delivery scores are read from: his completed trips and their orders. */
export interface DeliveryRatingSources {
  trips: { completedForDriver(driverId: string, since: Date): Promise<Trip[]> };
  orders: { get(orderId: string): Promise<Order> };
}

/**
 * The delivery scores (1–5) customers gave a courier/driver, newest trips first, stopping at
 * `COURIER_RATING_WINDOW` (scoring §1's "last 50"): his trips completed in the last
 * `DELIVERY_RATING_LOOKBACK_DAYS`, each order's `rating.delivery`. One reading for both the
 * Partner scorecard's rating and the public rating on the customer's driver card (joy l2), so the
 * two never disagree.
 */
export async function deliveryRatings(sources: DeliveryRatingSources, driverId: string, now: Date): Promise<Array<{ score: number; at: Date }>> {
  const since = new Date(now.getTime() - DELIVERY_RATING_LOOKBACK_DAYS * DAY_MS);
  const done = (await sources.trips.completedForDriver(driverId, since))
    .filter((t) => t.state === 'completed')
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const out: Array<{ score: number; at: Date }> = [];
  for (const trip of done) {
    if (out.length >= COURIER_RATING_WINDOW) break;
    const rated = await Promise.all(
      trip.orders.map((link) =>
        sources.orders.get(link.orderId).then(
          (o) => o,
          // An order the orders module no longer knows has no score to give.
          () => null,
        ),
      ),
    );
    for (const o of rated) {
      const score = o?.rating?.delivery;
      if (o?.rating && typeof score === 'number') out.push({ score, at: o.rating.ratedAt });
    }
  }
  return out.slice(0, COURIER_RATING_WINDOW);
}
