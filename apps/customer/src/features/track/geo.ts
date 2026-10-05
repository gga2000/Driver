/**
 * Map maths for the live screen, kept free of React Native so it runs in plain Node tests and as
 * Reanimated worklets (functions marked 'worklet' are called from `useAnimatedStyle`/`useAnimatedProps`).
 *
 * Projection is Web Mercator with 512-px tiles, the same as MapLibre GL, so the overlay we draw
 * (courier marker, route, home pin) lines up with the MapLibre camera at bearing 0 / pitch 0.
 */

export interface LngLat {
  lat: number;
  lng: number;
}

export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const TILE_SIZE = 512;
const MAX_LAT = 85.051129;

export function clamp(n: number, lo: number, hi: number): number {
  'worklet';
  return n < lo ? lo : n > hi ? hi : n;
}

export function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}

/** World x in px at `zoom` (0 at lng −180). */
export function mercX(lng: number, zoom: number): number {
  'worklet';
  return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
}

/** World y in px at `zoom` (0 at the north edge). */
export function mercY(lat: number, zoom: number): number {
  'worklet';
  const phi = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * TILE_SIZE * Math.pow(2, zoom);
}

/** Screen position of a point for a camera centred in a view of `size`. */
export function project(lat: number, lng: number, cam: Camera, size: Size): Point {
  'worklet';
  return {
    x: mercX(lng, cam.zoom) - mercX(cam.lng, cam.zoom) + size.w / 2,
    y: mercY(lat, cam.zoom) - mercY(cam.lat, cam.zoom) + size.h / 2,
  };
}

/** Inverse of `project`: the lng/lat under a screen point. */
export function unproject(p: Point, cam: Camera, size: Size): LngLat {
  'worklet';
  const scale = TILE_SIZE * Math.pow(2, cam.zoom);
  const x = mercX(cam.lng, cam.zoom) + p.x - size.w / 2;
  const y = mercY(cam.lat, cam.zoom) + p.y - size.h / 2;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** Initial great-circle bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = (Math.atan2(y, x) * 180) / Math.PI;
  return (θ + 360) % 360;
}

/** Equirectangular distance in metres (fine at town scale). */
export function distanceM(a: LngLat, b: LngLat): number {
  const k = 111_320;
  const dx = (b.lng - a.lng) * k * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * k;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * `to` unwrapped next to `from` so a rotation from 350° to 10° turns 20° clockwise instead of 340°
 * back round. The result may leave [0, 360) — rotate by it as-is.
 */
export function nearestAngle(from: number, to: number): number {
  'worklet';
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return from + d;
}

/**
 * What is left of a route once the courier is at `pos`: `pos` itself, then every waypoint after
 * the segment he is nearest to. The line visibly shortens as he drives.
 */
export function remainingRoute(route: readonly LngLat[], pos: LngLat): LngLat[] {
  if (route.length === 0) return [pos];
  if (route.length === 1) return [pos, route[0]!];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const d = distanceToSegmentM(pos, route[i]!, route[i + 1]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return [pos, ...route.slice(best + 1)];
}

function distanceToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  // Local metric plane around `a`.
  const k = 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lng - a.lng) * k * cos;
  const by = (b.lat - a.lat) * k;
  const px = (p.lng - a.lng) * k * cos;
  const py = (p.lat - a.lat) * k;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : clamp((px * bx + py * by) / len2, 0, 1);
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Screen transform that carries a layer drawn for camera `drawn` to where camera `live` shows it:
 * RN transforms (translate, then scale about the layer's centre). Lets an SVG layer rendered once
 * follow a pan/zoom or camera animation on the UI thread, then be redrawn when the camera settles.
 */
export function layerTransform(drawn: Camera, live: Camera, size: Size): { tx: number; ty: number; s: number } {
  'worklet';
  const s = Math.pow(2, live.zoom - drawn.zoom);
  const kx = (mercX(drawn.lng, drawn.zoom) - size.w / 2) * s - mercX(live.lng, live.zoom) + size.w / 2;
  const ky = (mercY(drawn.lat, drawn.zoom) - size.h / 2) * s - mercY(live.lat, live.zoom) + size.h / 2;
  return { tx: kx + ((s - 1) * size.w) / 2, ty: ky + ((s - 1) * size.h) / 2, s };
}

/** Camera that fits `points` inside `size` minus `pad` (top, right, bottom, left), zoom clamped. */
export function fitCamera(
  points: readonly LngLat[],
  size: Size,
  pad: { top: number; right: number; bottom: number; left: number },
  zoomRange: [number, number] = [12, 16.5],
): Camera {
  if (points.length === 0) return { lat: 32.909, lng: 45.065, zoom: zoomRange[0] };
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  const innerW = Math.max(40, size.w - pad.left - pad.right);
  const innerH = Math.max(40, size.h - pad.top - pad.bottom);
  // Size of the box at zoom 0, then the zoom that makes it fit.
  const dx = mercX(east, 0) - mercX(west, 0);
  const dy = mercY(south, 0) - mercY(north, 0);
  const zx = dx > 0 ? Math.log2(innerW / dx) : zoomRange[1];
  const zy = dy > 0 ? Math.log2(innerH / dy) : zoomRange[1];
  const zoom = clamp(Math.min(zx, zy), zoomRange[0], zoomRange[1]);
  // Centre of the box, shifted so it sits in the middle of the padded area.
  const cx = (mercX(east, zoom) + mercX(west, zoom)) / 2 - (pad.left - pad.right) / 2;
  const cy = (mercY(south, zoom) + mercY(north, zoom)) / 2 - (pad.top - pad.bottom) / 2;
  const c = unproject({ x: cx - mercX(0, zoom) + 0, y: cy - mercY(0, zoom) }, { lng: 0, lat: 0, zoom }, { w: 0, h: 0 });
  return { lat: c.lat, lng: c.lng, zoom };
}

/** SVG path data through screen points. */
export function pathD(points: readonly Point[]): string {
  'worklet';
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}
