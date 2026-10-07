import type { RegularPoint } from '@driver/contracts';
import type { Spot } from '@/features/ride/logic';

/**
 * The two ends of a ride booked for later on this phone (joy J7d), so «خليها رحلة ثابتة» can start
 * the regular trip with them. In memory: the booking itself lives on the server.
 */
const spots = new Map<string, { pickup: RegularPoint; dropoff: RegularPoint }>();

/** A ride place as a regular trip's end (the saved-place link kept for saved places). */
export function pointOfSpot(s: Pick<Spot, 'id' | 'kind' | 'title' | 'zoneId' | 'pin'>): RegularPoint {
  return { zoneKey: s.zoneId, pin: s.pin, label: s.title.slice(0, 60), ...(s.kind === 'saved' ? { placeId: s.id.replace(/^saved:/, '') } : {}) };
}

export const bookedMemory = {
  remember: (orderId: string, pickup: Spot, dropoff: Spot) => spots.set(orderId, { pickup: pointOfSpot(pickup), dropoff: pointOfSpot(dropoff) }),
  get: (orderId: string) => spots.get(orderId) ?? null,
};
