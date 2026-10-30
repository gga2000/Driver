/**
 * The zone map on the Golden hour street map (web): the map's two addresses from the build, and the
 * zones and the kitchen as GeoJSON for MapLibre (pure, unit-tested; no MapLibre here).
 */
import type { LatLng } from '@driver/contracts';
import { MIN_RING_POINTS, type ZoneShade } from './logic';

/** Our map file and its Arabic letters (`EXPO_PUBLIC_MAP_*`); missing → the plain drawing. */
export function goldenMapUrls(env: Record<string, string | undefined>): { tilesUrl: string; glyphsUrl: string } | null {
  const tilesUrl = env.EXPO_PUBLIC_MAP_TILES_URL?.trim();
  const glyphsUrl = env.EXPO_PUBLIC_MAP_GLYPHS_URL?.trim();
  return tilesUrl && glyphsUrl ? { tilesUrl, glyphsUrl } : null;
}

interface ZoneLike {
  key: string;
  ring: readonly LatLng[];
  centre: LatLng;
}

type Position = [number, number];
export interface ZoneFeature {
  type: 'Feature';
  properties: { key: string; fill: string; dashed: boolean; selected: boolean; kind: 'zone' | 'dot' | 'kitchen' };
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'Point'; coordinates: Position };
}

const pos = (p: LatLng): Position => [p.lng, p.lat];

/** Each zone as a polygon (or a dot at its centre while it has no outline), the selected one last, then the kitchen. */
export function zoneFeatures<Z extends ZoneLike>(zones: readonly Z[], shade: (zone: Z) => ZoneShade, selectedKey: string | null | undefined, kitchen: LatLng | null): { type: 'FeatureCollection'; features: ZoneFeature[] } {
  const ordered = [...zones].sort((a, b) => Number(a.key === selectedKey) - Number(b.key === selectedKey));
  const features: ZoneFeature[] = ordered.map((z) => {
    const s = shade(z);
    const properties = { key: z.key, fill: s.fill, dashed: s.dashed, selected: z.key === selectedKey };
    if (z.ring.length >= MIN_RING_POINTS) {
      const ring = z.ring.map(pos);
      const [first] = ring;
      const last = ring[ring.length - 1]!;
      const closed = first && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
      return { type: 'Feature', properties: { ...properties, kind: 'zone' }, geometry: { type: 'Polygon', coordinates: [closed] } };
    }
    return { type: 'Feature', properties: { ...properties, kind: 'dot' }, geometry: { type: 'Point', coordinates: pos(z.centre) } };
  });
  if (kitchen) features.push({ type: 'Feature', properties: { key: 'kitchen', fill: '', dashed: false, selected: false, kind: 'kitchen' }, geometry: { type: 'Point', coordinates: pos(kitchen) } });
  return { type: 'FeatureCollection', features };
}

/** West, south, east, north around every zone and the kitchen; null when there is nothing to show. */
export function zoneBounds(zones: readonly ZoneLike[], kitchen: LatLng | null): [number, number, number, number] | null {
  const pts = [...zones.flatMap((z) => (z.ring.length >= MIN_RING_POINTS ? z.ring : [z.centre])), ...(kitchen ? [kitchen] : [])];
  if (pts.length === 0) return null;
  const lngs = pts.map((p) => p.lng);
  const lats = pts.map((p) => p.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
