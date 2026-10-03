import type { LatLng } from '@driver/contracts';

/** Domain §2: the arrival geofence. Inside it the "وصلت" button arms; the tap itself is the official event. */
export const GEOFENCE_RADIUS_M = 60;

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function withinGeofence(pin: LatLng, target: LatLng, radiusM = GEOFENCE_RADIUS_M): boolean {
  return haversineMeters(pin, target) <= radiusM;
}

/**
 * Evaluates an arrival tap against the stop: the distance is recorded, a tap outside the
 * geofence is flagged — never blocked (domain §2). Unknown position or target = not flagged
 * (nothing to compare), distance null.
 */
export function evaluateArrival(pin: LatLng | null, target: LatLng | null, radiusM = GEOFENCE_RADIUS_M): { distanceM: number | null; outside: boolean } {
  if (!pin || !target) return { distanceM: null, outside: false };
  const d = haversineMeters(pin, target);
  return { distanceM: Math.round(d), outside: d > radiusM };
}

/** A point `meters` north of `from` — handy for tests and the simulator. */
export function offsetNorth(from: LatLng, meters: number): LatLng {
  return { lat: from.lat + (meters / EARTH_RADIUS_M) * (180 / Math.PI), lng: from.lng };
}
