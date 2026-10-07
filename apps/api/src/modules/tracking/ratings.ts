import { deliveryRatings, type DeliveryRatingSources } from '../scoring/index.js';
import type { TrackingRatingsPort } from './tracking.service.js';

/**
 * The delivery scores customers gave a courier/driver, for the public rating on his card (joy l2):
 * the same reading as his Partner scorecard (`deliveryRatings`: newest completed trips, up to 50).
 * Read once per card (the tracking card cache).
 */
export function tripsOrdersRatings(trips: DeliveryRatingSources['trips'], orders: DeliveryRatingSources['orders'], now: () => Date): TrackingRatingsPort {
  return {
    courierScores: (courierId) => deliveryRatings({ trips, orders }, courierId, now()),
  };
}
