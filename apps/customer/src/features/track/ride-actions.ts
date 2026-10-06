import type { Phase } from './timeline';

const BEFORE_PICKUP: ReadonlySet<Phase> = new Set(['searching', 'reassigning', 'to_pickup', 'at_pickup']);

/**
 * A ride can be cancelled until the rider is in the car (L-16): once the trip is under way the
 * honest path is "عندي مشكلة", not cancel. (Rides never set `pickedUpAt`, so the food rule can't say.)
 */
export function rideCanCancel(phase: Phase): boolean {
  return BEFORE_PICKUP.has(phase);
}

/**
 * The floating driver card over the map: before pickup it carries the plate (the safety check at the
 * kerb, L-06) and a call button; on the trip the rider is in his car, so share the trip comes first
 * and the call moves into the sheet (L-16).
 */
export function floatMode(phase: Phase): 'plate' | 'trip' {
  return phase === 'on_the_way' ? 'trip' : 'plate';
}
