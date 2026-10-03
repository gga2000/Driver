import type { LatLng } from '@driver/contracts';

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

/** Road factor and speed for ETAs until OSRM is hosted (plan Step 5, decision 4). */
export const ROAD_FACTOR = 1.4;
export const CITY_SPEED_KMH = 25;

/** Minutes to drive between two points: haversine × 1.4 at 25 km/h. */
export function etaMin(a: LatLng, b: LatLng): number {
  return (haversineKm(a, b) * ROAD_FACTOR * 60) / CITY_SPEED_KMH;
}
