import { ROAD_FACTOR, TOWN_SPEED_KMH, type LatLng } from '@driver/contracts';

/** Haversine distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Degrees clockwise from north, from `a` towards `b`. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The point `distanceM` metres from `p` towards `bearing` (flat-earth step: fine at town scale). */
export function offsetPin(p: LatLng, distanceM: number, bearing: number): LatLng {
  const r = (bearing * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(r)) / 111_320;
  const dLng = (distanceM * Math.sin(r)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/**
 * Minutes (fractional) for a courier between two points — dispatch's synchronous timing (auto-assign
 * start, batching). The shared straight-line rule from contracts (×1.4 at bike speed), so dispatch and
 * every app agree; road-time dispatch through the routing module is SP4b-2.
 */
export function etaMin(a: LatLng, b: LatLng): number {
  return (haversineKm(a, b) * ROAD_FACTOR * 60) / TOWN_SPEED_KMH.bike;
}
