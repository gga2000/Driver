import type { OrderTracking } from '@driver/contracts';
import type { TrackingMoment } from '@driver/map/golden';
import type { LngLat } from './geo';
import { buildPath, pointAt, projectOnPath, type Path } from './motion';
import { courierAtDoor, phaseOf } from './timeline';

/**
 * The live order map in 3D (Ali, 2026-10-09: "I like the 3D design … use it as much as possible"):
 * which of the four moments the order is in, and the route split the map draws. The camera and
 * layers come from `@driver/map/golden` (docs/specs/2026-10-09-map-golden-hour-design.md, "The order map").
 */

/** Closer than this to the door (straight line, about 3 minutes on a motorbike), the ride turns into the `near` shot; the server's «almost there» stamp counts too. */
export const NEAR_M = 900;

export function momentOf(v: OrderTracking, toDoorM: number | null): TrackingMoment {
  const phase = phaseOf(v);
  if (phase === 'arrived' || phase === 'done' || phase === 'unreachable' || courierAtDoor(v) || v.order.deliveredAt) return 'arrived';
  if (phase === 'on_the_way') {
    const nearAt = v.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.courierNearAt;
    return nearAt || (toDoorM !== null && toDoorM <= NEAR_M) ? 'near' : 'on_the_way';
  }
  return 'kitchen';
}

type Pt = [number, number];
const pt = (p: LngLat): Pt => [p.lng, p.lat];

export interface RouteParts {
  plan: Pt[] | null;
  done: Pt[] | null;
  ahead: Pt[] | null;
}

/**
 * The road as the map draws it. Kitchen: the way he will come, kitchen → door (`plan`). On the way:
 * the driven part (`done`, quiet) and what is still ahead (`ahead`, cased, glint), split at `d`
 * metres along the road. Arrived: nothing. With no road shape yet (or no road router), the same
 * parts are drawn straight: kitchen → door, and kitchen → courier → door while he rides.
 */
export function routeParts(moment: TrackingMoment, road: Path | null, opts: { kitchen: LngLat | null; door: LngLat | null; d: number | null; courier?: LngLat | null }): RouteParts {
  const none: RouteParts = { plan: null, done: null, ahead: null };
  if (moment === 'arrived') return none;
  if (!road) {
    const { kitchen, door, courier } = opts;
    if (!door) return none;
    if (moment === 'kitchen') return kitchen ? routeParts(moment, buildPath([kitchen, door]), { ...opts, courier: null }) : none;
    if (!courier) return none;
    const straight = buildPath(kitchen ? [kitchen, courier, door] : [courier, door]);
    return routeParts(moment, straight, { ...opts, d: straight && kitchen ? straight.cum[1]! : 0 });
  }
  const path = road;
  if (moment === 'kitchen') {
    const from = opts.kitchen ? projectOnPath(path, opts.kitchen).d : 0;
    return { ...none, plan: slice(path, from, path.length) };
  }
  const d = opts.d ?? 0;
  return { plan: null, done: d > 0 ? slice(path, 0, d) : null, ahead: slice(path, d, path.length) };
}

/** The part of the path between `a` and `b` metres, with exact ends. */
function slice(path: Path, a: number, b: number): Pt[] | null {
  if (b - a < 1) return null;
  const out: Pt[] = [pt(pointAt(path, a))];
  for (let i = 0; i < path.pts.length; i++) if (path.cum[i]! > a && path.cum[i]! < b) out.push(pt(path.pts[i]!));
  out.push(pt(pointAt(path, b)));
  return out;
}

export function routeGeoJSON(parts: RouteParts): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const part of ['plan', 'done', 'ahead'] as const) {
    const coords = parts[part];
    if (coords && coords.length >= 2) features.push({ type: 'Feature', properties: { part }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

/** Ray casting: is `p` inside the polygon ring (lng/lat pairs)? */
export function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** About this many metres: the stand-in when no house of the map sits exactly under the pin. */
const STAND_IN_HALF_M = 6;

/** The one building that matters (kitchen, then the door): the map's own house, else a small block. */
export function litBuilding(at: LngLat, houses: readonly { ring: readonly Pt[]; hm: number }[]): GeoJSON.FeatureCollection {
  const p = pt(at);
  const hit = houses.find((h) => inRing(p, h.ring));
  const dLat = STAND_IN_HALF_M / 111_320;
  const dLng = dLat / Math.cos((at.lat * Math.PI) / 180);
  const ring: Pt[] = hit
    ? [...hit.ring]
    : [
        [p[0] - dLng, p[1] - dLat],
        [p[0] + dLng, p[1] - dLat],
        [p[0] + dLng, p[1] + dLat],
        [p[0] - dLng, p[1] + dLat],
        [p[0] - dLng, p[1] - dLat],
      ];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { hm: hit?.hm ?? 6 }, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}
