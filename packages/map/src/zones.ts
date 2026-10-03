import { AZIZIYAH_CENTRE, AZIZIYAH_ZONES, type AziziyahZoneSeed, type ZoneTier } from '@driver/contracts';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { TIER_COLORS } from './colors.js';
import { M_PER_DEG_LAT, metresPerDegLng, regularPolygon, type LngLat } from './geo.js';

export interface ZoneProps {
  id: string;
  extId: string;
  name_ar: string;
  name_en: string;
  tier: ZoneTier;
  group: string;
  /** Fill colour for the tier, so a renderer without data-driven styling still shades correctly. */
  color: string;
  radiusM: number;
}

/**
 * Map labels in Western digits (voice guide: 0–9 everywhere): the zone seed keeps the official
 * spelling ("شارع ٣٠"), the map shows "شارع 30" like every other screen.
 */
export function labelDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export type ZoneFeature = Feature<Polygon, ZoneProps>;
export type ZoneCollection = FeatureCollection<Polygon, ZoneProps>;

/**
 * The 34 Aziziyah zones as GeoJSON hexagons built from the seed centroids and draft radii
 * (`aziziyah-zones.ts`), each carrying its tier and tier colour. Draft geometry until drivers verify
 * the polygons in Partner (plan decision 1). Feature `id` is the zone index so MapLibre
 * feature-state (hover) works.
 */
export function buildZonesGeoJSON(zones: readonly AziziyahZoneSeed[] = AZIZIYAH_ZONES): ZoneCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Polygon', coordinates: [regularPolygon(z.lat, z.lng, z.radiusM)] },
      properties: {
        id: z.id,
        extId: z.extId,
        name_ar: labelDigits(z.name_ar),
        name_en: z.name_en,
        tier: z.tier,
        group: z.group,
        color: TIER_COLORS[z.tier],
        radiusM: z.radiusM,
      },
    })),
  };
}

/** Zone centroids as points (labels, hit targets, SVG fallback). */
export function buildZoneCentroidsGeoJSON(zones: readonly AziziyahZoneSeed[] = AZIZIYAH_ZONES): FeatureCollection<Point, ZoneProps> {
  return {
    type: 'FeatureCollection',
    features: zones.map((z, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [z.lng, z.lat] },
      properties: {
        id: z.id,
        extId: z.extId,
        name_ar: labelDigits(z.name_ar),
        name_en: z.name_en,
        tier: z.tier,
        group: z.group,
        color: TIER_COLORS[z.tier],
        radiusM: z.radiusM,
      },
    })),
  };
}

export function zoneById(id: string, zones: readonly AziziyahZoneSeed[] = AZIZIYAH_ZONES): AziziyahZoneSeed | undefined {
  return zones.find((z) => z.id === id);
}

/** `[[west, south], [east, north]]`, MapLibre `LngLatBoundsLike`. */
export type Bounds = [LngLat, LngLat];

/** Bounding box of the zones' hexagons plus a margin in metres. */
export function zonesBounds(zones: readonly AziziyahZoneSeed[] = AZIZIYAH_ZONES, marginM = 800): Bounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const z of zones) {
    const dLat = (z.radiusM + marginM) / M_PER_DEG_LAT;
    const dLng = (z.radiusM + marginM) / metresPerDegLng(z.lat);
    west = Math.min(west, z.lng - dLng);
    east = Math.max(east, z.lng + dLng);
    south = Math.min(south, z.lat - dLat);
    north = Math.max(north, z.lat + dLat);
  }
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return [
    [r(west), r(south)],
    [r(east), r(north)],
  ];
}

/** Aziziyah view: the 34 zones with an 800 m margin. */
export const AZIZIYAH_BOUNDS: Bounds = zonesBounds();
/** Map centre in `[lng, lat]`. */
export const AZIZIYAH_CENTER: LngLat = [AZIZIYAH_CENTRE.lng, AZIZIYAH_CENTRE.lat];
/** A zoom that frames the town on a 1280-px desktop; fitBounds refines it on load. */
export const AZIZIYAH_DEFAULT_ZOOM = 12.5;
/** Panning is limited to a generous box around the town (Kut/Baghdad trips leave it; that's fine). */
export const AZIZIYAH_MAX_BOUNDS: Bounds = zonesBounds(AZIZIYAH_ZONES, 15_000);
