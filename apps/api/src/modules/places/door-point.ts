import { DOOR_RULES, type DoorSample, type LatLng } from '@driver/contracts';
import { distanceM } from './zones.js';

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const medianPoint = (ps: readonly LatLng[]): LatLng => ({ lat: median(ps.map((p) => p.lat)), lng: median(ps.map((p) => p.lng)) });

/**
 * The door couriers actually reach (maps program a3), or null while unknown. Why a median of a
 * cluster: one courier tapping "وصلت" from the corner, or a GPS jump, must not move the door; only
 * `minSamples` arrivals agreeing within `clusterM` of each other's middle do. Fixes far from the
 * customer's current pin are ignored, so moving the pin forgets the old door by itself.
 */
export function doorPoint(samples: readonly DoorSample[], pin: LatLng): LatLng | null {
  const usable = samples.filter((s) => s.accuracyM <= DOOR_RULES.maxAccuracyM && distanceM(s, pin) <= DOOR_RULES.maxFromPinM);
  if (usable.length < DOOR_RULES.minSamples) return null;
  const centre = medianPoint(usable);
  const cluster = usable.filter((s) => distanceM(s, centre) <= DOOR_RULES.clusterM);
  return cluster.length >= DOOR_RULES.minSamples ? medianPoint(cluster) : null;
}

/** The samples to keep after one more arrival: newest `keep`, one per drop-off. */
export function withSample(samples: readonly DoorSample[], next: DoorSample): DoorSample[] {
  if (samples.some((s) => s.stopId === next.stopId)) return [...samples];
  return [...samples, next].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-DOOR_RULES.keep);
}
