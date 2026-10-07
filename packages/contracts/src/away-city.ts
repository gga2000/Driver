import { haversineM } from './tracking.js';

/**
 * Which far city of the الرجعة network a point is in (ride idea n9 «Baghdad mode»): the phone is "in
 * Baghdad" (or Kut) when it is within that city's radius of one of its garages. The network has no
 * city outlines, only garages with their city, so each far city gets a radius around its garages that
 * covers the city and stops well short of the road home (Aziziyah's garages are ~75 km from Baghdad's
 * and ~80 km from Kut's, as the crow flies), so a rider half-way home is not told about cars leaving the city behind him.
 * Aziziyah's own garages never count: at home there is no car back to catch.
 */
export const AWAY_CITY_RADIUS_KM: Readonly<Record<string, number>> = {
  baghdad: 20,
  kut: 10,
};

/** The home side of every corridor. */
export const AWAY_CITY_HOME = 'aziziyah';

export interface AwayCityGarage {
  cityId: string;
  lat: number;
  lng: number;
}

/**
 * The far city whose garage is nearest to `at` and within that city's radius, or null (at home, on
 * the road, unknown position, or a city with no radius set).
 */
export function awayCityAt(at: { lat: number; lng: number } | null, garages: readonly AwayCityGarage[], radiusKm: Readonly<Record<string, number>> = AWAY_CITY_RADIUS_KM): string | null {
  if (!at) return null;
  let best: { cityId: string; m: number } | null = null;
  for (const g of garages) {
    if (g.cityId === AWAY_CITY_HOME) continue;
    const r = radiusKm[g.cityId];
    if (r === undefined) continue;
    const m = haversineM(at, g);
    if (m <= r * 1000 && (!best || m < best.m)) best = { cityId: g.cityId, m };
  }
  return best?.cityId ?? null;
}
