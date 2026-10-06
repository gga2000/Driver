import type { LngLat } from './geo';
import type { Phase } from './timeline';

/** Where the camera looks at each step of a delivery (maps program SP5b, c4). */
export interface Shot {
  points: LngLat[];
  /** Zoom clamp for fitting `points`. */
  zoom: [number, number];
}

/** Closer than this to the door (metres, straight line): the camera tightens on him and the door. */
export const CLOSE_IN_M = 400;
/** On the way and far: the frame reaches this share of the way ahead toward the door … */
export const LOOK_AHEAD = 0.5;
/** … and this share behind him, so he sits a little behind the middle with more road ahead. */
export const LOOK_BEHIND = 0.2;

/** The point `k` of the way from `a` to `b` (negative: behind `a`). */
function toward(a: LngLat, b: LngLat, k: number): LngLat {
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

/** Town overview → street level. */
const WIDE: [number, number] = [12.5, 16.5];
const KITCHEN_CLOSE: [number, number] = [15.8, 16.4];
const DOOR_CLOSE: [number, number] = [15.5, 17];
/** A ride still looking for a driver: the pickup at street level, so the radar and nearby cars read (L-03). */
const PICKUP_SEARCH: [number, number] = [15.5, 15.5];

/**
 * The story the camera tells for a food order: the kitchen close up while it cooks; the courier and
 * the kitchen while he goes to collect; the courier and the door on the way, tightening as he gets
 * close; the door once it arrived. A ride still searching sits on the pickup; rides otherwise and
 * anything unknown fall back to everything still ahead.
 */
export function storyShot(input: {
  phase: Phase;
  ride: boolean;
  courier: LngLat | null;
  kitchen: LngLat | null;
  door: LngLat | null;
  /** The route's remaining waypoints and start, for the fallback. */
  ahead: LngLat[];
  /** Metres from the courier to the door, when known. */
  toDoorM: number | null;
  /** Rides: where the rider waits. */
  pickup?: LngLat | null;
}): Shot {
  const { phase, ride, courier, kitchen, door, ahead, toDoorM, pickup = null } = input;
  const some = (...pts: Array<LngLat | null>): LngLat[] => pts.filter((p): p is LngLat => p !== null);
  if (!ride) {
    if ((phase === 'waiting_merchant' || phase === 'preparing') && kitchen && !courier) return { points: [kitchen], zoom: KITCHEN_CLOSE };
    if ((phase === 'to_pickup' || phase === 'at_pickup' || phase === 'preparing') && kitchen) return { points: some(courier, kitchen), zoom: WIDE };
    if (phase === 'on_the_way' && door) {
      if (toDoorM !== null && toDoorM <= CLOSE_IN_M) return { points: some(courier, door), zoom: DOOR_CLOSE };
      // Far still (f19, maps c4 "follow with look-ahead"): him near the middle with road ahead, instead
      // of courier and door pinned to opposite corners.
      if (courier) return { points: [courier, toward(courier, door, LOOK_AHEAD), toward(courier, door, -LOOK_BEHIND)], zoom: WIDE };
      return { points: [door], zoom: WIDE };
    }
    if ((phase === 'arrived' || phase === 'done') && door) return { points: [door], zoom: DOOR_CLOSE };
  }
  if (ride && phase === 'searching' && pickup) return { points: [pickup], zoom: PICKUP_SEARCH };
  const pts = some(courier, ...ahead);
  return { points: pts.length > 0 ? pts : some(door), zoom: WIDE };
}
