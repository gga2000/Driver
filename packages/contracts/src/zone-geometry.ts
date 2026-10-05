import { AZIZIYAH_ZONES, type AziziyahZoneSeed } from './aziziyah-zones.js';
import type { LatLng } from './common.js';

/** Fewest corners a zone outline may have. */
export const ZONE_MIN_POINTS = 3;
/** Most corners a zone outline may have; hand-drawn neighbourhoods stay far below it. */
export const ZONE_MAX_POINTS = 80;
/** Smallest zone (about 70 m × 70 m): anything smaller is a slip of the mouse, not a neighbourhood. */
export const ZONE_MIN_AREA_M2 = 5_000;
/** Largest zone (50 km²): the far villages are big, but never this big. */
export const ZONE_MAX_AREA_M2 = 50_000_000;
/**
 * Overlap two neighbouring outlines may share and still count as one border (about 45 m × 45 m):
 * hand-drawn borders never meet exactly, and a sliver must not block saving.
 */
export const ZONE_OVERLAP_TOLERANCE_M2 = 2_000;
/** How far past the seed zones an outline may reach, in degrees (about 11 km). */
export const ZONE_SERVICE_MARGIN_DEG = 0.1;

/** Overlap estimate: a grid of ~20 m cells over the shared bounding box, 10–300 cells per side. */
const OVERLAP_CELL_M = 20;
const OVERLAP_GRID_MIN = 10;
const OVERLAP_GRID_MAX = 300;
/** Metres per degree of latitude (WGS84 mean); city-sized shapes need nothing finer. */
const M_PER_DEG_LAT = 110_574;
/** Metres per degree of longitude at the equator, scaled by cos(latitude). */
const M_PER_DEG_LNG_EQUATOR = 111_320;
/** The seed hexagons use one degree length on both axes; drafts must match them exactly. */
const DRAFT_M_PER_DEG = 111_320;

export interface ZoneBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Another zone's saved outline, for the overlap check. */
export interface PlacedOutline {
  key: string;
  ring: readonly LatLng[];
}

/** Why an outline can't be saved; the Console shows it live and the API refuses with it. */
export type ZoneShapeProblem =
  | { kind: 'too_few_points' }
  | { kind: 'too_many_points' }
  | { kind: 'outside_service_area' }
  | { kind: 'self_crossing' }
  | { kind: 'too_small'; areaM2: number }
  | { kind: 'too_large'; areaM2: number }
  | { kind: 'centre_outside' }
  | { kind: 'overlap'; withKey: string; areaM2: number };

const rad = (deg: number): number => (deg * Math.PI) / 180;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clampInt = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Flat metres around `origin` (x east, y north). At city scale the error is far below a metre. */
export function toLocalM(p: LatLng, origin: LatLng): { x: number; y: number } {
  return { x: (p.lng - origin.lng) * M_PER_DEG_LNG_EQUATOR * Math.cos(rad(origin.lat)), y: (p.lat - origin.lat) * M_PER_DEG_LAT };
}

/** Inverse of `toLocalM`. */
export function fromLocalM(q: { x: number; y: number }, origin: LatLng): LatLng {
  return { lat: origin.lat + q.y / M_PER_DEG_LAT, lng: origin.lng + q.x / (M_PER_DEG_LNG_EQUATOR * Math.cos(rad(origin.lat))) };
}

/** The ring without a closing point, so callers may pass open or closed rings (GeoJSON closes them). */
export function openRing(ring: readonly LatLng[]): LatLng[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && first.lat === last.lat && first.lng === last.lng) return ring.slice(0, -1);
  return [...ring];
}

/** Area in m² (shoelace in local metres). */
export function ringAreaM2(ring: readonly LatLng[]): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  const o = r[0]!;
  let twice = 0;
  for (let i = 0; i < r.length; i++) {
    const p = toLocalM(r[i]!, o);
    const q = toLocalM(r[(i + 1) % r.length]!, o);
    twice += p.x * q.y - q.x * p.y;
  }
  return Math.abs(twice) / 2;
}

/** Area-weighted centre; the corner average when the ring has no area. */
export function ringCentroid(ring: readonly LatLng[]): LatLng {
  const r = openRing(ring);
  if (r.length === 0) throw new RangeError('ringCentroid needs at least one point');
  const o = r[0]!;
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const p = toLocalM(r[i]!, o);
    const q = toLocalM(r[(i + 1) % r.length]!, o);
    const cross = p.x * q.y - q.x * p.y;
    twice += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twice) < 1e-6) {
    return { lat: r.reduce((s, p) => s + p.lat, 0) / r.length, lng: r.reduce((s, p) => s + p.lng, 0) / r.length };
  }
  return fromLocalM({ x: cx / (3 * twice), y: cy / (3 * twice) }, o);
}

/** Ray casting; the ring may be open or closed. */
export function pointInRing(p: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Signed turn of p→q→r; the sign survives the per-axis scaling between degrees and metres. */
function orient(p: LatLng, q: LatLng, r: LatLng): number {
  return (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
}

/** Proper crossing only: segments that merely touch or run along each other don't count. */
function segmentsCross(a1: LatLng, a2: LatLng, b1: LatLng, b2: LatLng): boolean {
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two non-neighbouring edges cross (a bow-tie): such an outline has no clear inside. */
export function ringSelfIntersects(ring: readonly LatLng[]): boolean {
  const r = openRing(ring);
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(r[i]!, r[(i + 1) % n]!, r[j]!, r[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

function boundsOfRing(ring: readonly LatLng[]): ZoneBounds {
  return {
    minLat: Math.min(...ring.map((p) => p.lat)),
    maxLat: Math.max(...ring.map((p) => p.lat)),
    minLng: Math.min(...ring.map((p) => p.lng)),
    maxLng: Math.max(...ring.map((p) => p.lng)),
  };
}

/**
 * Shared area of two outlines in m², estimated on a grid over their common bounding box. Exact for
 * boxes, within a few percent otherwise; bounded work (at most 300 × 300 samples).
 */
export function overlapAreaM2(a: readonly LatLng[], b: readonly LatLng[]): number {
  const ra = openRing(a);
  const rb = openRing(b);
  if (ra.length < 3 || rb.length < 3) return 0;
  const ba = boundsOfRing(ra);
  const bb = boundsOfRing(rb);
  const box: ZoneBounds = {
    minLat: Math.max(ba.minLat, bb.minLat),
    maxLat: Math.min(ba.maxLat, bb.maxLat),
    minLng: Math.max(ba.minLng, bb.minLng),
    maxLng: Math.min(ba.maxLng, bb.maxLng),
  };
  if (box.minLat >= box.maxLat || box.minLng >= box.maxLng) return 0;
  const corner = { lat: box.minLat, lng: box.minLng };
  const far = toLocalM({ lat: box.maxLat, lng: box.maxLng }, corner);
  const nx = clampInt(Math.ceil(far.x / OVERLAP_CELL_M), OVERLAP_GRID_MIN, OVERLAP_GRID_MAX);
  const ny = clampInt(Math.ceil(far.y / OVERLAP_CELL_M), OVERLAP_GRID_MIN, OVERLAP_GRID_MAX);
  const dLat = (box.maxLat - box.minLat) / ny;
  const dLng = (box.maxLng - box.minLng) / nx;
  let inside = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = { lat: box.minLat + (j + 0.5) * dLat, lng: box.minLng + (i + 0.5) * dLng };
      if (pointInRing(p, ra) && pointInRing(p, rb)) inside += 1;
    }
  }
  return inside * (far.x / nx) * (far.y / ny);
}

/** Box around points, widened by `marginDeg` on every side. */
export function zoneBoundsOf(points: readonly LatLng[], marginDeg = ZONE_SERVICE_MARGIN_DEG): ZoneBounds {
  const b = boundsOfRing(points);
  return { minLat: b.minLat - marginDeg, maxLat: b.maxLat + marginDeg, minLng: b.minLng - marginDeg, maxLng: b.maxLng + marginDeg };
}

const SERVICE_BOUNDS = new Map<string, ZoneBounds>([['aziziyah', zoneBoundsOf(AZIZIYAH_ZONES)]]);

/** Where a city's outlines may be drawn; null for a city with no zones. */
export function zoneServiceBounds(cityId: string): ZoneBounds | null {
  return SERVICE_BOUNDS.get(cityId) ?? null;
}

function insideBounds(p: LatLng, b: ZoneBounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/**
 * The first reason an outline can't be saved, or null. `others` are the other zones' saved
 * (non-draft) outlines: the AI hexagons overlap freely and are not checked.
 */
export function zoneShapeProblem(ring: readonly LatLng[], centre: LatLng, bounds: ZoneBounds, others: readonly PlacedOutline[]): ZoneShapeProblem | null {
  const r = openRing(ring);
  if (r.length < ZONE_MIN_POINTS) return { kind: 'too_few_points' };
  if (r.length > ZONE_MAX_POINTS) return { kind: 'too_many_points' };
  if (!r.every((p) => insideBounds(p, bounds))) return { kind: 'outside_service_area' };
  if (ringSelfIntersects(r)) return { kind: 'self_crossing' };
  const areaM2 = Math.round(ringAreaM2(r));
  if (areaM2 < ZONE_MIN_AREA_M2) return { kind: 'too_small', areaM2 };
  if (areaM2 > ZONE_MAX_AREA_M2) return { kind: 'too_large', areaM2 };
  if (!pointInRing(centre, r)) return { kind: 'centre_outside' };
  for (const o of others) {
    const shared = overlapAreaM2(r, o.ring);
    if (shared > ZONE_OVERLAP_TOLERANCE_M2) return { kind: 'overlap', withKey: o.key, areaM2: Math.round(shared) };
  }
  return null;
}

/** The AI-drafted outline: a hexagon of `radiusM` around the seed centre (same as the database seed). */
export function draftRing(z: Pick<AziziyahZoneSeed, 'lat' | 'lng' | 'radiusM'>): LatLng[] {
  const dLat = z.radiusM / DRAFT_M_PER_DEG;
  const dLng = z.radiusM / (DRAFT_M_PER_DEG * Math.cos(rad(z.lat)));
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return { lat: round6(z.lat + dLat * Math.sin(a)), lng: round6(z.lng + dLng * Math.cos(a)) };
  });
}
