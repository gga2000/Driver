import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { services } from '@driver/design-tokens';
import { GOLDEN_FONTS } from './fonts.js';
import { metresBetween, pathMetres, slicePath, type LngLat } from './metres.js';

/**
 * "Your map" (the stats tab «خريطتك», Ali 2026-10-11, look A "Streets"): the customer's own trips on the Golden hour
 * map, each along the streets it took (the route the server sends), coloured by service and thicker the more often it
 * was taken. Kitchens show how many meals came from them, home is an ink dot in a cream ring, and each الرجعة trip leaves
 * its garage as a short dashed arrow towards Baghdad or Kut. Read-only and the customer's own data only. Lines draw
 * once (MY_TRIPS_DRAW_MS), the pins come in after, then nothing moves.
 */

export type MyTripService = 'food' | 'taxi' | 'tuktuk' | 'rajaa';
/** A point as the server sends it. */
export interface LatLng { lat: number; lng: number }

export interface MyTrips {
  home: LatLng | null;
  /** Kitchens the customer ordered from; `count` is meals. */
  kitchens: readonly (LatLng & { count: number })[];
  /**
   * Food: kitchen → drop-off. Rides: pickup → drop-off. الرجعة: garage → the city (only its direction is drawn).
   * `path`: the streets the trip took, from `from` to `to` (the route the server planned or the courier drove); without
   * it the trip is a straight line between its ends.
   */
  traces: readonly { service: MyTripService; from: LatLng; to: LatLng; count: number; path?: readonly LatLng[] }[];
}

export type MyTripsLight = 'golden' | 'day';

/** The one-time draw of the lines; the pins come in over the next MY_TRIPS_PINS_MS, then nothing moves. */
export const MY_TRIPS_DRAW_MS = 1200;
export const MY_TRIPS_PINS_MS = 300;
/** Flat and north-up, so the streets read like a map of the town; pinch and pan stay free. */
export const MY_TRIPS_CAMERA = { pitch: 0, bearing: 0 } as const;

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

/** The trip's line (its streets, else straight), drawn from its start up to `k` (0–1) of its length. */
function tripLine(t: MyTrips['traces'][number], k: number): LngLat[] {
  const line = t.path && t.path.length >= 2 ? t.path.map(ll) : [ll(t.from), ll(t.to)];
  if (k >= 1) return line;
  const cum = pathMetres(line);
  return slicePath(line, 0, (cum[cum.length - 1] ?? 0) * k);
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
    if (t.service === 'rajaa') { const w = away(t); pts.push(w.a, w.end); } else pts.push(...tripLine(t, 1));
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
  // thin lines first, so a habit is drawn over a one-off
  for (const t of [...trips.traces].sort((x, y) => x.count - y.count)) {
    const c = SERVICE_INK[t.service], w = myTripWidth(t.count);
    if (t.service !== 'rajaa') {
      const line = tripLine(t, k);
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
 * The layers for `myTripsGeoJSON`, all on top of the map (the tab has no other overlay): the trips on a cream
 * under-stroke, the dashed الرجعة arrows, then kitchens, home and the arrow words.
 */
export function myTripsLayers(opts: { source: string; light: MyTripsLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'mytrips', src = opts.source;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return [
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
