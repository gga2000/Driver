import type { BoardOrder, LatLng } from '@driver/contracts';

/**
 * N16, the tablet sees the courier coming (map ideas, Ali 2026-10-11): who is on his way to this kitchen
 * and where, for the map panel on the board. Free of React Native and MapLibre so it is unit-tested.
 * His spot comes from the radar the board already carries (metres and direction from the kitchen), so
 * the tablet learns nothing the radar didn't already say.
 */

export type LngLat = [number, number];

/** The shop warms once when the first courier is this many minutes out (the idea's "2 دقيقة"). */
export const WARM_AT_MIN = 2;
/** The warm glow rises and settles over this long, once (motion rule: play once and settle). */
export const WARM_MS = 2400;
/**
 * The panel shows the street around the shop: a courier farther than this stands at its edge, on the
 * line he is coming along, until he is inside it (his minutes always say the truth).
 */
export const SHOW_MAX_M = 220;
/** The panel never zooms out past the shop's own 3D model (restaurants fade in by 16). */
export const MIN_ZOOM = 16;
/** Dots kept behind each courier, and the smallest step that adds one. */
export const TRAIL_MAX = 10;
export const TRAIL_STEP_M = 12;

const M_PER_DEG_LAT = 111_320;

/** The point `distanceM` from `from` along a compass bearing (flat earth: a few km in one town). */
export function pointFrom(from: LatLng, distanceM: number, bearingDeg: number): LngLat {
  const rad = (bearingDeg * Math.PI) / 180;
  const north = distanceM * Math.cos(rad);
  const east = distanceM * Math.sin(rad);
  const lat = from.lat + north / M_PER_DEG_LAT;
  const lng = from.lng + east / (M_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180));
  return [lng, lat];
}

/** Metres between two points (flat earth, as above). */
export function metresBetween(a: LngLat, b: LngLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * M_PER_DEG_LAT;
}

export interface ComingCourier {
  orderId: string;
  /** The ticket number the kitchen calls («#214»). */
  number: string;
  firstName: string | null;
  photoUrl: string | null;
  /** Whole minutes to the counter (the one ETA); null when the server has none yet. */
  etaMinutes: number | null;
  /** Where the panel draws him: his radar spot, or the edge of the shown street when he is farther. */
  at: LngLat;
  /** Farther than SHOW_MAX_M: drawn at the edge on his line, not where he is. */
  far: boolean;
}

/** Couriers on their way with a radar fix, nearest first (minutes, then metres). */
export function comingCouriers(orders: readonly BoardOrder[], kitchen: LatLng): ComingCourier[] {
  const out: (ComingCourier & { d: number })[] = [];
  for (const o of orders) {
    const c = o.courier;
    if (c.state !== 'on_the_way' || c.distanceM == null || c.bearingDeg == null) continue;
    const far = c.distanceM > SHOW_MAX_M;
    out.push({ orderId: o.id, number: o.number, firstName: c.firstName, photoUrl: c.photoUrl ?? null, etaMinutes: c.etaMinutes, at: pointFrom(kitchen, Math.min(c.distanceM, SHOW_MAX_M), c.bearingDeg), far, d: c.distanceM });
  }
  out.sort((a, b) => (a.etaMinutes ?? Infinity) - (b.etaMinutes ?? Infinity) || a.d - b.d);
  return out.map(({ d: _d, ...c }) => c);
}

/**
 * The dotted way behind each courier: his last spots, oldest first. A spot joins when he moved at least
 * TRAIL_STEP_M; couriers no longer coming are dropped.
 */
export function nextTrails(prev: ReadonlyMap<string, readonly LngLat[]>, couriers: readonly ComingCourier[]): Map<string, LngLat[]> {
  const next = new Map<string, LngLat[]>();
  for (const c of couriers) {
    // No way drawn while he stands at the edge: the dots start where he really is.
    if (c.far) {
      next.set(c.orderId, []);
      continue;
    }
    const trail = [...(prev.get(c.orderId) ?? [])];
    const last = trail[trail.length - 1];
    if (!last || metresBetween(last, c.at) >= TRAIL_STEP_M) trail.push(c.at);
    next.set(c.orderId, trail.slice(-TRAIL_MAX));
  }
  return next;
}

/**
 * Whether the shop should warm now: a courier just came inside WARM_AT_MIN who had not warmed it yet.
 * Returns the new set of couriers that have warmed it (one warm per courier per order).
 */
export function warmNow(warmed: ReadonlySet<string>, couriers: readonly ComingCourier[]): { warm: boolean; warmed: Set<string> } {
  const near = couriers.filter((c) => c.etaMinutes !== null && c.etaMinutes <= WARM_AT_MIN).map((c) => c.orderId);
  const fresh = near.some((id) => !warmed.has(id));
  // Keep the ones still near, so a courier who leaves and comes back near warms it again.
  return { warm: fresh, warmed: new Set(near) };
}

/**
 * The warm glow's strength over its one rise and settle (0 → 1 → the lit shop's resting 0), for the
 * restaurant glow layer. `t` is ms since the warm began.
 */
export function warmAt(t: number): number {
  if (t <= 0 || t >= WARM_MS) return 0;
  const x = t / WARM_MS;
  // Up quickly over the first third, then a slow settle.
  return x < 1 / 3 ? x * 3 : 1 - (x - 1 / 3) * 1.5;
}

/** The trails as one GeoJSON source of dots (the way he came), oldest faint. */
export function trailGeoJSON(trails: ReadonlyMap<string, readonly LngLat[]>): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const [orderId, pts] of trails) {
    // The newest spot is under his photo; the dots are the way behind him.
    pts.slice(0, -1).forEach((p, i, all) => features.push({ type: 'Feature', properties: { orderId, a: (i + 1) / (all.length + 1) }, geometry: { type: 'Point', coordinates: p } }));
  }
  return { type: 'FeatureCollection', features };
}

/** The camera's line: from the nearest courier up the street to the shop (the courier at the bottom). */
export function panelFrame(kitchen: LatLng, couriers: readonly ComingCourier[]): { from: LngLat; to: LngLat } {
  const shop: LngLat = [kitchen.lng, kitchen.lat];
  const first = couriers[0];
  return { from: first ? first.at : shop, to: shop };
}

/**
 * Who gets a pin: the nearest always (at the edge while far), the others once they are really on the
 * shown street, so two far couriers never stack at the edge. The chip counts them all.
 */
export function pinned(couriers: readonly ComingCourier[]): ComingCourier[] {
  return couriers.filter((c, i) => i === 0 || !c.far);
}

type Golden = typeof import('@driver/map/golden');

/** The panel's camera: tilted, the nearest courier at the bottom and the shop up the street, both on screen. */
export function panelCamera(golden: Golden, kitchen: LatLng, couriers: readonly ComingCourier[], size: { w: number; h: number }): { center: LngLat; zoom: number; bearing: number; pitch: number } {
  const { from, to } = panelFrame(kitchen, couriers);
  const bearing = from[0] === to[0] && from[1] === to[1] ? 0 : golden.bearingBetween(from, to);
  // Room for «محلك» over the shop and his photo and minutes under him.
  // Room for «محلك» over the shop and the chip; his photo and minutes stand above his own spot.
  const fit = golden.fitCamera([from, to], { width: size.w, height: size.h, padding: { top: 96, bottom: 20, left: 40, right: 40 }, bearing, maxZoom: 17.6 });
  // Never so far out that the shop's own model fades (the restaurants show from zoom 16).
  return { center: fit.center, zoom: Math.max(MIN_ZOOM, fit.zoom), bearing, pitch: 50 };
}
