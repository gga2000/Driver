import { z } from 'zod';
import type { LatLng } from './common.js';

/**
 * The straight-line basics the travel estimates share (re-exported from tracking). Their own module so
 * a schema that needs only these (food doors, live, habits) doesn't carry the whole tracking file into
 * the merchant bundle.
 */

/** How an ETA was worked out: on real roads (OSRM) or by the straight-line estimate (`travelMinutes`). */
export const EtaBasis = z.enum(['road', 'estimated']);
export type EtaBasis = z.infer<typeof EtaBasis>;

/** Road ≈ 1.4 × straight line (`travelMinutes`, `TOWN_SPEED_KMH` in tracking). */
export const ROAD_FACTOR = 1.4;

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
