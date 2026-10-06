import { M_PER_DEG_LAT, metresPerDegLng } from './geo.js';

/** A point in WGS84 degrees, as the API sends zone rings and pins. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A fitted view: the box size in px and where a coordinate lands in it (x east, y south, north up). */
export interface SvgProjection {
  width: number;
  height: number;
  x(lng: number): number;
  y(lat: number): number;
}

export interface FitOptions {
  /** Empty space kept around the drawing, px. */
  paddingPx?: number;
  /** Height ÷ width limits: a town stretched along the river still fits a phone or a tablet panel. */
  minAspect?: number;
  maxAspect?: number;
}

/** Room around the outer zones so the outermost borders and the kitchen pin are never clipped. */
export const SVG_FIT_PADDING_PX = 12;
/** The town box can be flatter or taller than the panel; these bound the panel's own shape. */
export const SVG_FIT_MIN_ASPECT = 0.55;
export const SVG_FIT_MAX_ASPECT = 1.25;

/**
 * Fits points into a `width`-wide SVG box with the equirectangular projection the Console's fallback
 * map uses (fine at town scale), keeping real ground proportions: a kilometre east is as long as a
 * kilometre north. The height follows the area's shape within the aspect limits; when the limit
 * bites, the drawing is centred with one scale for both axes so the zones never squash. For maps
 * without tiles (the Merchant app's delivery area), where every shape comes from the API.
 */
export function fitProjection(points: readonly GeoPoint[], width: number, options: FitOptions = {}): SvgProjection {
  const pad = options.paddingPx ?? SVG_FIT_PADDING_PX;
  const minAspect = options.minAspect ?? SVG_FIT_MIN_ASPECT;
  const maxAspect = options.maxAspect ?? SVG_FIT_MAX_ASPECT;
  if (points.length === 0 || !(width > 2 * pad)) {
    const height = Math.round(width * minAspect);
    return { width, height, x: () => width / 2, y: () => height / 2 };
  }
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  const mPerLng = metresPerDegLng((south + north) / 2);
  // A single point (or a line) still needs a non-zero box: give it 100 m of ground each way.
  const groundW = Math.max((east - west) * mPerLng, 100);
  const groundH = Math.max((north - south) * M_PER_DEG_LAT, 100);
  const innerW = width - 2 * pad;
  const aspect = Math.min(maxAspect, Math.max(minAspect, groundH / groundW));
  const height = Math.round(innerW * aspect + 2 * pad);
  const innerH = height - 2 * pad;
  const pxPerM = Math.min(innerW / groundW, innerH / groundH);
  const midLng = (west + east) / 2;
  const midLat = (south + north) / 2;
  return {
    width,
    height,
    x: (lng) => width / 2 + (lng - midLng) * mPerLng * pxPerM,
    y: (lat) => height / 2 - (lat - midLat) * M_PER_DEG_LAT * pxPerM,
  };
}

/** SVG `points` for a ring (open or closed) under a projection, one decimal. */
export function svgPoints(ring: readonly GeoPoint[], projection: Pick<SvgProjection, 'x' | 'y'>): string {
  return ring.map((p) => `${projection.x(p.lng).toFixed(1)},${projection.y(p.lat).toFixed(1)}`).join(' ');
}
