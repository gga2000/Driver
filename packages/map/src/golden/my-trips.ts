import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { services } from '@driver/design-tokens';
import { GOLDEN_FONTS } from './golden-style.js';
import { metresBetween, type LngLat } from './metres.js';

/**
 * "Your map" (the stats tab «خريطتك», Ali 2026-10-11): the customer's own trips on the Golden hour map, as soft arcs
 * from every kitchen and pickup to where it ended, on a lightly faded map. Arcs, not streets: the server knows where
 * each trip started and ended, and the map says no more than that. Kitchens show how many meals came from them, home is
 * an ink dot in a cream ring, and each الرجعة trip leaves its garage as a short dashed arrow towards Baghdad or Kut.
 * Read-only and the customer's own data only. Lines draw once (MY_TRIPS_DRAW_MS), the pins come in after, then still.
 */

export type MyTripService = 'food' | 'taxi' | 'tuktuk' | 'rajaa';
/** A point as the server sends it. */
export interface LatLng { lat: number; lng: number }

export interface MyTrips {
  home: LatLng | null;
  /** Kitchens the customer ordered from; `count` is meals. */
  kitchens: readonly (LatLng & { count: number })[];
  /** Food: kitchen → drop-off. Rides: pickup → drop-off. الرجعة: garage → the city (only its direction is drawn). */
  traces: readonly { service: MyTripService; from: LatLng; to: LatLng; count: number }[];
}

export type MyTripsLight = 'golden' | 'day';

/** The one-time draw of the lines; the pins come in over the next MY_TRIPS_PINS_MS, then nothing moves. */
export const MY_TRIPS_DRAW_MS = 1200;
export const MY_TRIPS_PINS_MS = 300;
/** A gentle tilt for the arcs; pinch and pan stay free. */
export const MY_TRIPS_CAMERA = { pitch: 40, bearing: -12 } as const;

const CREAM = '#FFFBF4';
const INK = '#24170E';
/** Each service in its home-screen colour (design tokens). */
const SERVICE_INK: Record<MyTripService, string> = {
  food: services.light.food.glow,
  taxi: services.light.taxi.glow,
  tuktuk: services.light.tuktuk.fill,
  rajaa: services.light.trips.card.dot,
};
/** Three widths only: a habit reads thick, a one-off thin. */
export function myTripWidth(count: number): number {
  return count >= 7 ? 7.5 : count >= 3 ? 5 : 3;
}

const BAGHDAD: LngLat = [44.3661, 33.3152];
const KUT: LngLat = [45.8206, 32.5128];
/** How far the الرجعة arrow runs out of its garage before the map lets it go. */
const AWAY_M = 650;

const ll = (p: LatLng): LngLat => [p.lng, p.lat];

/** A soft arc from a to b (the bulge is a fifth of the length, always to the same side), cut at `k` (0–1). */
function arc(a: LngLat, b: LngLat, k: number): LngLat[] {
  const c: LngLat = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.2, (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.2];
  const at = (t: number): LngLat => {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  };
  const n = 32, last = k * n, out: LngLat[] = [];
  for (let i = 0; i <= Math.floor(last); i++) out.push(at(i / n));
  if (last % 1 > 0) out.push(at(last / n));
  return out;
}

function away(t: MyTrips['traces'][number]) {
  const a = ll(t.from), b = ll(t.to);
  const d = metresBetween(a, b) || 1;
  const s = Math.min(1, AWAY_M / d);
  const end: LngLat = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const city = metresBetween(b, BAGHDAD) < metresBetween(b, KUT) ? ('baghdad' as const) : ('kut' as const);
  return { a, end, city };
}

/** What the map should fit on screen (pad it on the screen side): home, kitchens, trips and the الرجعة arrows. */
export function myTripsBounds(trips: MyTrips): [LngLat, LngLat] | null {
  const pts: LngLat[] = [...(trips.home ? [ll(trips.home)] : []), ...trips.kitchens.map(ll)];
  for (const t of trips.traces) {
    if (t.service === 'rajaa') { const w = away(t); pts.push(w.a, w.end); } else pts.push(ll(t.from), ll(t.to));
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/**
 * The trips as one GeoJSON source. `k` (0–1) draws the lines from their start: step it once over MY_TRIPS_DRAW_MS,
 * then pass `pins: true`; leave both out for the drawn, still map (also the reduce-motion state). `labels` are the
 * arrows' words from the app's copy («لبغداد», «للكوت»).
 */
export function myTripsGeoJSON(trips: MyTrips, opts: { labels: { baghdad: string; kut: string }; k?: number; pins?: boolean }) {
  const k = opts.k === undefined ? 1 : Math.max(0, Math.min(1, opts.k));
  const pins = opts.pins ?? opts.k === undefined;
  const features: { type: 'Feature'; properties: Record<string, string | number>; geometry: { type: 'Point' | 'LineString' | 'Polygon'; coordinates: unknown } }[] = [];
  const b = myTripsBounds(trips);
  if (b) {
    const [[w, s], [e, n]] = b, m = 0.3;
    features.push({ type: 'Feature', properties: { part: 'veil' }, geometry: { type: 'Polygon', coordinates: [[[w - m, s - m], [e + m, s - m], [e + m, n + m], [w - m, n + m], [w - m, s - m]]] } });
  }
  // thin lines first, so a habit is drawn over a one-off
  for (const t of [...trips.traces].sort((x, y) => x.count - y.count)) {
    const c = SERVICE_INK[t.service], w = myTripWidth(t.count);
    if (t.service !== 'rajaa') {
      const line = arc(ll(t.from), ll(t.to), k);
      if (line.length >= 2) features.push({ type: 'Feature', properties: { part: 'trip', c, w }, geometry: { type: 'LineString', coordinates: line } });
      continue;
    }
    const { a, end: full, city } = away(t);
    const end: LngLat = [a[0] + (full[0] - a[0]) * k, a[1] + (full[1] - a[1]) * k];
    if (k > 0) features.push({ type: 'Feature', properties: { part: 'away', c, w }, geometry: { type: 'LineString', coordinates: [a, end] } });
    if (k === 1) {
      const dx = full[0] - a[0], dy = full[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, h = 0.0011;
      features.push({ type: 'Feature', properties: { part: 'head', c }, geometry: { type: 'Polygon', coordinates: [[[full[0] + ux * h, full[1] + uy * h], [full[0] - uy * h * 0.6, full[1] + ux * h * 0.6], [full[0] + uy * h * 0.6, full[1] - ux * h * 0.6], [full[0] + ux * h, full[1] + uy * h]]] } });
      features.push({ type: 'Feature', properties: { part: 'label', label: opts.labels[city] }, geometry: { type: 'Point', coordinates: full } });
    }
  }
  if (pins) {
    for (const p of trips.kitchens) features.push({ type: 'Feature', properties: { part: 'kitchen', n: String(p.count), r: p.count >= 7 ? 15 : p.count >= 3 ? 12.5 : 10 }, geometry: { type: 'Point', coordinates: ll(p) } });
    if (trips.home) features.push({ type: 'Feature', properties: { part: 'home' }, geometry: { type: 'Point', coordinates: ll(trips.home) } });
  }
  return { type: 'FeatureCollection' as const, features };
}

const part = (p: string) => ['==', ['get', 'part'], p] as never;

/**
 * The layers for `myTripsGeoJSON`, all on top of the map (the tab has no other overlay): a light cream fade over the
 * town, the arcs on a cream under-stroke, the dashed الرجعة arrows, then kitchens, home and the arrow words.
 */
export function myTripsLayers(opts: { source: string; light: MyTripsLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'mytrips', src = opts.source;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return [
    { id: `${id}-veil`, type: 'fill', source: src, filter: part('veil'), paint: { 'fill-color': CREAM, 'fill-opacity': opts.light === 'day' ? 0.3 : 0.38 } },
    { id: `${id}-under`, type: 'line', source: src, filter: part('trip'), layout: round, paint: { 'line-color': CREAM, 'line-width': ['+', ['get', 'w'], 4] } },
    { id: `${id}-line`, type: 'line', source: src, filter: part('trip'), layout: round, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'] } },
    { id: `${id}-away-under`, type: 'line', source: src, filter: part('away'), layout: round, paint: { 'line-color': CREAM, 'line-width': ['+', ['get', 'w'], 4] } },
    { id: `${id}-away`, type: 'line', source: src, filter: part('away'), layout: { 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-dasharray': [2, 1.4] } },
    { id: `${id}-head`, type: 'fill', source: src, filter: part('head'), paint: { 'fill-color': ['get', 'c'] } },
    {
      id: `${id}-kitchen`, type: 'circle', source: src, filter: part('kitchen'),
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': services.light.food.fill, 'circle-stroke-color': CREAM, 'circle-stroke-width': 2.5, 'circle-pitch-alignment': 'viewport' },
    },
    {
      id: `${id}-kitchen-n`, type: 'symbol', source: src, filter: part('kitchen'),
      layout: { 'text-field': ['get', 'n'], 'text-font': [...GOLDEN_FONTS.bold], 'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': services.light.food.on },
    },
    { id: `${id}-home-ring`, type: 'circle', source: src, filter: part('home'), paint: { 'circle-radius': 11, 'circle-color': CREAM, 'circle-stroke-color': 'rgba(36,23,14,0.18)', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'viewport' } },
    { id: `${id}-home`, type: 'circle', source: src, filter: part('home'), paint: { 'circle-radius': 6, 'circle-color': INK, 'circle-pitch-alignment': 'viewport' } },
    {
      id: `${id}-label`, type: 'symbol', source: src, filter: part('label'),
      layout: { 'text-field': ['get', 'label'], 'text-font': [...GOLDEN_FONTS.bold], 'text-size': 13, 'text-offset': [0, -1.1], 'text-allow-overlap': true },
      paint: { 'text-color': '#5E2E12', 'text-halo-color': CREAM, 'text-halo-width': 2.5 },
    },
  ];
}
