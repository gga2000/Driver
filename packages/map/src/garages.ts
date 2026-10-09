import type { FeatureCollection, Point } from 'geojson';

/**
 * The four intercity garages (console spec "Garage view": البوابة 1، البوابة 2، السوق، النهضة).
 * Mirrors the garage meeting points in `packages/db/prisma/seed-data.ts` (keys and coordinates must
 * stay in step); النهضة is the Baghdad end of the Aziziyah–Baghdad line, so it sits outside the
 * town view and is flagged `inCity: false`.
 */
export interface Garage {
  key: string;
  cityId: 'aziziyah' | 'baghdad';
  name_ar: string;
  name_en: string;
  lat: number;
  lng: number;
  /** Late-meter geofence radius (decisions §8). */
  geofenceM: number;
  inCity: boolean;
}

export const GARAGES: readonly Garage[] = [
  { key: 'garage_bab1', cityId: 'aziziyah', name_ar: 'كراج البوابة 1', name_en: 'Gate 1 garage', lat: 32.9032, lng: 45.0578, geofenceM: 150, inCity: true },
  { key: 'garage_bab2', cityId: 'aziziyah', name_ar: 'كراج البوابة 2', name_en: 'Gate 2 garage', lat: 32.9088, lng: 45.0648, geofenceM: 150, inCity: true },
  { key: 'garage_souq', cityId: 'aziziyah', name_ar: 'كراج السوق', name_en: 'Souq garage', lat: 32.9062, lng: 45.0612, geofenceM: 150, inCity: true },
  { key: 'garage_nahdha', cityId: 'baghdad', name_ar: 'كراج النهضة', name_en: 'Al-Nahdha garage', lat: 33.3344, lng: 44.4165, geofenceM: 150, inCity: false },
];

export type GarageProps = Omit<Garage, 'lat' | 'lng'>;

/** Garages as GeoJSON points. `onlyInCity` drops النهضة (Baghdad) for the town map. */
export function buildGaragesGeoJSON(opts: { onlyInCity?: boolean } = {}): FeatureCollection<Point, GarageProps> {
  const list = opts.onlyInCity ? GARAGES.filter((g) => g.inCity) : GARAGES;
  return {
    type: 'FeatureCollection',
    features: list.map(({ lat, lng, ...props }, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: props,
    })),
  };
}
