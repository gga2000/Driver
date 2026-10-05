import { clamp, lerp, nearestAngle, type LngLat } from './geo';

/**
 * How the courier moves on the customer's map (maps program SP5a). He glides along the road shape the
 * server routed (`orders.route`) between GPS fixes, keeps moving at his speed for a few seconds when a
 * fix is late, never hops backwards over a small correction, and turns with the road. Functions marked
 * 'worklet' run on the UI thread every frame; the rest run on the JS thread when a fix arrives.
 */

/** A fix within this distance of the road path is on it (GPS error in narrow streets). */
export const SNAP_M = 30;
/** A fix up to this far behind the drawn marker: hold still until he catches up rather than hop back. */
export const BACKTRACK_HOLD_M = 40;
/** After a glide, keep moving at his speed for at most this long without a new fix. */
export const DEAD_RECKON_MAX_S = 12;
/** Slower than this he is waiting (a light, the counter): no dead reckoning. */
export const MIN_MOVING_MPS = 1;
/** Dead-reckoning speed cap (about 60 km/h in town). */
export const MAX_SPEED_MPS = 17;
/** Heading from the point this far ahead on the road: smooth turns at corners. */
export const HEADING_LOOKAHEAD_M = 12;
/** He strays this far from the road path: ask the server for a new route. */
export const REROUTE_OFF_M = 50;
/** Refresh the route at least this often. */
export const ROUTE_STALE_MS = 120_000;

const M_PER_DEG = 111_320;

/** A road path with cumulative distances, for constant-time "where is d metres along". */
export interface Path {
  pts: LngLat[];
  /** Metres from the start to each point. */
  cum: number[];
  length: number;
}

function segM(a: LngLat, b: LngLat): number {
  'worklet';
  const dx = (b.lng - a.lng) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.sqrt(dx * dx + dy * dy);
}

function bearing(a: LngLat, b: LngLat): number {
  'worklet';
  const dx = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = b.lat - a.lat;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function buildPath(points: readonly LngLat[]): Path | null {
  if (points.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + segM(points[i - 1]!, points[i]!));
  return { pts: [...points], cum, length: cum[cum.length - 1]! };
}

/** The point `d` metres along the path (clamped to its ends). */
export function pointAt(path: Path, d: number): LngLat {
  'worklet';
  const x = clamp(d, 0, path.length);
  let lo = 0;
  let hi = path.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const a = path.pts[lo]!;
  const b = path.pts[hi]!;
  const span = path.cum[hi]! - path.cum[lo]!;
  const t = span > 0 ? (x - path.cum[lo]!) / span : 0;
  return { lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) };
}

/** The road's direction at `d`, looking a little ahead so corners turn smoothly (degrees from north). */
export function headingAt(path: Path, d: number): number {
  'worklet';
  const ahead = Math.min(path.length, d + HEADING_LOOKAHEAD_M);
  const behind = Math.max(0, ahead - HEADING_LOOKAHEAD_M - 2);
  return bearing(pointAt(path, behind), pointAt(path, ahead));
}

/** Where `p` falls on the path: metres along it and how far off it is. */
export function projectOnPath(path: Path, p: LngLat): { d: number; offM: number } {
  let best = { d: 0, offM: Infinity };
  for (let i = 0; i < path.pts.length - 1; i++) {
    const a = path.pts[i]!;
    const b = path.pts[i + 1]!;
    const cos = Math.cos((a.lat * Math.PI) / 180);
    const bx = (b.lng - a.lng) * M_PER_DEG * cos;
    const by = (b.lat - a.lat) * M_PER_DEG;
    const px = (p.lng - a.lng) * M_PER_DEG * cos;
    const py = (p.lat - a.lat) * M_PER_DEG;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : clamp((px * bx + py * by) / len2, 0, 1);
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offM) best = { d: path.cum[i]! + t * (path.cum[i + 1]! - path.cum[i]!), offM: off };
  }
  return best;
}

/** What is still ahead from `d`: the point at `d`, then every later point of the path. */
export function remainingFrom(path: Path, d: number): LngLat[] {
  'worklet';
  const out: LngLat[] = [pointAt(path, d)];
  for (let i = 0; i < path.pts.length; i++) if (path.cum[i]! > d) out.push(path.pts[i]!);
  return out;
}

/**
 * One glide of the marker. `line`: straight between two points (no road path, or he is off it).
 * `path`: along the road from `fromD` to `toD` metres over the poll interval, then on for at most
 * `tailM` metres at `tailPerT` metres per poll interval (dead reckoning) until the next fix.
 */
export type Glide =
  | { kind: 'line'; from: LngLat; to: LngLat; fromHeading: number; toHeading: number }
  | { kind: 'path'; fromD: number; toD: number; tailM: number; tailPerT: number; fromHeading: number; from: LngLat; to: LngLat };

export interface MarkerState {
  pos: LngLat;
  heading: number;
  /** Metres along the current path, when the marker is on it. */
  d: number | null;
}

/** Where the marker is `t` of the way through a glide (t > 1: the dead-reckoning tail). */
export function glidePos(g: Glide, path: Path | null, t: number): MarkerState {
  'worklet';
  if (g.kind === 'line' || !path) {
    // A road glide whose path went away (a new route arrived) finishes as a straight one.
    const k = clamp(t, 0, 1);
    const toHeading = g.kind === 'line' ? g.toHeading : g.fromHeading;
    return { pos: { lat: lerp(g.from.lat, g.to.lat, k), lng: lerp(g.from.lng, g.to.lng, k) }, heading: lerp(g.fromHeading, toHeading, k), d: null };
  }
  const d = t <= 1 ? lerp(g.fromD, g.toD, clamp(t, 0, 1)) : Math.min(g.toD + (t - 1) * g.tailPerT, g.toD + g.tailM, path.length);
  return { pos: pointAt(path, d), heading: nearestAngle(g.fromHeading, headingAt(path, d)), d };
}

/** Below this the courier is standing still: keep his heading rather than spin on GPS noise. */
const STILL_M = 4;

/**
 * The next glide when a fix arrives (JS thread). On the road path: along it, holding still over a
 * small backwards correction, with a dead-reckoning tail when he is moving. Off it (or no path): the
 * straight glide of before, turning to the device bearing or the direction of travel.
 */
export function planGlide(path: Path | null, current: MarkerState, fix: LngLat & { bearing?: number | null; speedKmh?: number | null }, pollMs: number): Glide {
  if (path) {
    const to = projectOnPath(path, fix);
    const from = current.d !== null ? { d: current.d, offM: 0 } : projectOnPath(path, current.pos);
    if (to.offM <= SNAP_M && from.offM <= SNAP_M) {
      const behind = from.d - to.d;
      const toD = behind > 0 && behind < BACKTRACK_HOLD_M ? from.d : to.d;
      const mps = clamp((fix.speedKmh ?? 0) / 3.6, 0, MAX_SPEED_MPS);
      const moving = mps >= MIN_MOVING_MPS && toD < path.length;
      return {
        kind: 'path',
        fromD: from.d,
        toD,
        tailM: moving ? Math.min(DEAD_RECKON_MAX_S * mps, path.length - toD) : 0,
        tailPerT: moving ? (mps * pollMs) / 1000 : 0,
        fromHeading: current.heading,
        from: current.pos,
        to: pointAt(path, toD),
      };
    }
  }
  const moved = segM(current.pos, fix);
  const raw = fix.bearing ?? (moved >= STILL_M ? bearing(current.pos, fix) : current.heading);
  return { kind: 'line', from: current.pos, to: { lat: fix.lat, lng: fix.lng }, fromHeading: current.heading, toHeading: nearestAngle(current.heading, raw) };
}

/** How far past 1 the glide progress may run: the dead-reckoning tail, in poll intervals. */
export function tailSpan(g: Glide, pollMs: number): number {
  if (g.kind !== 'path' || g.tailM <= 0 || g.tailPerT <= 0) return 0;
  return Math.min(g.tailM / g.tailPerT, (DEAD_RECKON_MAX_S * 1000) / pollMs);
}
