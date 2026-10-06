import type { IntercityDirection } from '@driver/contracts';
import { suggestDirection, type GarageLike, type LatLngLike } from '@/features/rajaa/logic';

/** Before this Baghdad hour, someone with no other clue is more likely leaving town (D-09). */
export const OUTBOUND_UNTIL_HOUR = 12;

/**
 * Which way home's الرجعة card points (joy h10, discovery D-09). Someone at home in Aziziyah wants to
 * go; someone in Baghdad wants to come back:
 *  1. the phone's last known position near a garage decides (in Baghdad → the way back);
 *  2. else a deliver-to place (always in an Aziziyah zone) → out of Aziziyah, to Baghdad;
 *  3. else (a guest with no place): mornings outbound, afternoons and evenings the way back.
 */
export function rajaaHomeDirection(input: {
  position: LatLngLike | null;
  garages: readonly GarageLike[];
  hasAziziyahPlace: boolean;
  /** Baghdad wall-clock hour. */
  hour: number;
}): { direction: IntercityDirection; cityId: string } {
  const near = suggestDirection(input.position, input.garages);
  if (near) return near;
  if (input.hasAziziyahPlace || input.hour < OUTBOUND_UNTIL_HOUR) return { direction: 'from_aziziyah', cityId: 'baghdad' };
  return { direction: 'to_aziziyah', cityId: 'baghdad' };
}
