/** Small, dependency-free geometry helpers (WGS84, equirectangular — fine at town scale). */

export type LngLat = [lng: number, lat: number];

/** Metres per degree of latitude (mean). */
export const M_PER_DEG_LAT = 111_320;

/** Metres per degree of longitude at a latitude. */
export function metresPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A closed regular polygon ring around a centroid, in GeoJSON `[lng, lat]` order. Six sides by
 * default (the seed's draft "hexagon" zones), flat-topped, counter-clockwise (RFC 7946 outer ring).
 */
export function regularPolygon(lat: number, lng: number, radiusM: number, sides = 6): LngLat[] {
  if (sides < 3) throw new Error('a polygon needs at least 3 sides');
  if (!(radiusM > 0)) throw new Error('radius must be positive');
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / metresPerDegLng(lat);
  const ring: LngLat[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    ring.push([round6(lng + dLng * Math.cos(a)), round6(lat + dLat * Math.sin(a))]);
  }
  ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

/** Haversine distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Signed area of a ring (shoelace, in degree²): positive = counter-clockwise. */
export function ringArea(ring: readonly LngLat[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
