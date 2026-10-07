import { COURIER_RATING_WINDOW, type Order, type Trip } from '@driver/contracts';
import type { TrackingRatingsPort } from './tracking.service.js';

/** Scores older than this don't speak for him any more (and keep the read small). */
export const COURIER_RATING_LOOKBACK_DAYS = 90;

/**
 * The delivery scores customers gave a courier/driver, for the public rating on his card (joy l2):
 * his trips completed in the last `COURIER_RATING_LOOKBACK_DAYS`, newest first, each order's
 * `rating.delivery`, stopping at the rating window (`COURIER_RATING_WINDOW`, the scorecard's 50).
 * Read once per card (the tracking card cache).
 */
export function tripsOrdersRatings(
  trips: { completedForDriver(driverId: string, since: Date): Promise<Trip[]> },
  orders: { get(orderId: string): Promise<Order> },
  now: () => Date,
): TrackingRatingsPort {
  return {
    async courierScores(courierId) {
      const since = new Date(now().getTime() - COURIER_RATING_LOOKBACK_DAYS * 86_400_000);
      const done = (await trips.completedForDriver(courierId, since)).filter((t) => t.state === 'completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
      const out: Array<{ score: number; at: Date }> = [];
      for (const trip of done) {
        if (out.length >= COURIER_RATING_WINDOW) break;
        const rated = await Promise.all(
          trip.orders.map((link) =>
            orders.get(link.orderId).then(
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
    },
  };
}
