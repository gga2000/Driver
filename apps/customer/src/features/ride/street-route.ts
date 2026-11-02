/**
 * The line from the pickup to the pin, along the streets (Ali 2026-10-20). The router itself is shared
 * with the partner app and the server (`@driver/map/pieces/street-route`); this file keeps the ride
 * screens' imports and the distance words. Not the fare: the server still prices the ride by its zones.
 */
export { buildStreetGraph, MAX_SNAP_M, streetRoute, type LngLat, type StreetGraph, type StreetRoute } from '@driver/map/pieces/street-route';

/** The distance as people say it: metres to the nearest 50 under 1 km, else km with one decimal. */
export function distanceWords(m: number): { value: string; unit: 'm' | 'km' } {
  if (m < 950) return { value: String(Math.max(50, Math.round(m / 50) * 50)), unit: 'm' };
  return { value: (Math.round(m / 100) / 10).toFixed(1), unit: 'km' };
}
