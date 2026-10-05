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

/**
 * Minutes (fractional) for a courier between two points — dispatch's synchronous timing (auto-assign
 * start, batching). The shared straight-line rule from contracts (×1.4 at bike speed), so dispatch and
 * every app agree; road-time dispatch through the routing module is SP4b-2.
 */
export function etaMin(a: LatLng, b: LatLng): number {
  return (haversineKm(a, b) * ROAD_FACTOR * 60) / TOWN_SPEED_KMH.bike;
}
