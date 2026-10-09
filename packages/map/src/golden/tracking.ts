import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { serviceInk, type MapService } from './routes.js';
import type { GoldenLight } from './sun.js';

/**
 * The customer's live order map in four moments (Ali, 2026-10-09: "I like the 3D design … use it as
 * much as possible"). Couriers navigate in Google Maps; this map is for the customer to enjoy:
 * the kitchen lit in 3D, the ride over a risen town, a closer tilt as he nears, the house lit on arrival.
 * See docs/specs/2026-10-09-map-golden-hour-design.md, "The order map".
 */
export type TrackingMoment = 'kitchen' | 'on_the_way' | 'near' | 'arrived';

/** Build the style with `riseAt: TRACKING_RISE_ZOOM` so the town stands up for the whole ride. */
export const TRACKING_RISE_ZOOM = 15.2;
/** Camera moves between moments: one ease, never while a finger is on the map. */
export const TRACKING_EASE_MS = 1200;
/** One glint runs courier → door after each position update, then the line rests (no idle loop). */
export const TRACKING_GLINT_MS = 2400;

type LngLat = [number, number];

export interface TrackingPoints {
  /** The restaurant (or pickup). */
  from: LngLat;
  /** The customer's door. */
  to: LngLat;
  /** The courier, once one is on the way. */
  vehicle?: LngLat;
}

/** Either a fixed centre and zoom, or bounds to fit; always with the moment's tilt and heading. */
export interface TrackingCamera {
  pitch: number;
  bearing: number;
  center?: LngLat;
  zoom?: number;
  bounds?: [LngLat, LngLat];
  maxZoom?: number;
}

/** Compass bearing from `a` to `b`, degrees clockwise from north. */
export function bearingBetween(a: LngLat, b: LngLat): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

const bounds = (...pts: LngLat[]): [LngLat, LngLat] => [
  [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
  [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
];

/**
 * Where the camera sits in each moment. Heading always points the way the food travels, so the
 * door is "up the road". Fit `bounds` with padding that clears the header, courier card and sheet.
 */
export function trackingCamera(moment: TrackingMoment, pts: TrackingPoints): TrackingCamera {
  const at = pts.vehicle ?? pts.from;
  switch (moment) {
    case 'kitchen':
      return { center: pts.from, zoom: 17.1, pitch: 52, bearing: bearingBetween(pts.from, pts.to) };
    case 'on_the_way':
      return { bounds: bounds(at, pts.to), maxZoom: 16.8, pitch: 45, bearing: bearingBetween(at, pts.to) };
    case 'near':
      return { bounds: bounds(at, pts.to), maxZoom: 17.4, pitch: 50, bearing: bearingBetween(at, pts.to) };
    case 'arrived':
      return { center: pts.to, zoom: 17.9, pitch: 52, bearing: 25 };
  }
}

/**
 * The route's colour along its length with a glint at `at` (0 = courier, 1 = door). Set it as the
 * `ahead` layer's `line-gradient` and step `at` from 0 to 1 over TRACKING_GLINT_MS once per update;
 * pass `null` to rest the line (also the reduce-motion state).
 */
export function glintGradient(service: MapService, light: GoldenLight, at: number | null): ExpressionSpecification {
  const ink = serviceInk(service, light);
  if (at === null) return ['interpolate', ['linear'], ['line-progress'], 0, ink.route, 1, ink.route];
  const c = Math.min(0.95, Math.max(0.05, at));
  return ['interpolate', ['linear'], ['line-progress'], 0, ink.route, c - 0.04, ink.route, c, glint(light), c + 0.04, ink.route, 1, ink.route];
}

const glint = (light: GoldenLight) => (light === 'night' ? '#FFE9C2' : '#FFFAF0');

/**
 * The order map's own layers, added before `GOLDEN_FIRST_LABEL`:
 * - `routeSource` (GeoJSON with `lineMetrics: true`): LineStrings with `part` = `plan` (the way he
 *   will come, while the kitchen cooks), `done` (driven, 40 % of the colour) or `ahead` (cased, glint).
 * - `glowSource`: one Point; warm light pooled on the ground there (the kitchen, then the door).
 * - `litSource`: the one building that matters, as a polygon with `hm` (metres), lit in the service colour.
 * Pins (restaurant, courier photo, house) are screen markers drawn above the map, never map layers,
 * so no roof ever hides them.
 */
export function goldenTrackingLayers(opts: {
  service: MapService;
  light: GoldenLight;
  routeSource: string;
  glowSource: string;
  litSource: string;
  id?: string;
}): LayerSpecification[] {
  const ink = serviceInk(opts.service, opts.light);
  const id = opts.id ?? 'track';
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const part = (p: string) => ['==', ['get', 'part'], p] as never;
  const cased = ['any', part('plan'), part('ahead')] as never;
  return [
    {
      id: `${id}-glow`, type: 'circle', source: opts.glowSource,
      paint: {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 30, 18, 150],
        'circle-color': ink.route, 'circle-opacity': 0.45, 'circle-blur': 1, 'circle-pitch-alignment': 'map',
      },
    },
    { id: `${id}-done`, type: 'line', source: opts.routeSource, filter: part('done'), layout: round, paint: { 'line-color': ink.route, 'line-opacity': 0.4, 'line-width': 4 } },
    { id: `${id}-casing`, type: 'line', source: opts.routeSource, filter: cased, layout: round, paint: { 'line-color': ink.edge, 'line-opacity': 0.85, 'line-width': 8 } },
    { id: `${id}-plan`, type: 'line', source: opts.routeSource, filter: part('plan'), layout: round, paint: { 'line-color': ink.route, 'line-width': 5 } },
    { id: `${id}-ahead`, type: 'line', source: opts.routeSource, filter: part('ahead'), layout: round, paint: { 'line-width': 5, 'line-gradient': glintGradient(opts.service, opts.light, null) } },
    {
      id: `${id}-lit`, type: 'fill-extrusion', source: opts.litSource,
      paint: { 'fill-extrusion-color': ink.route, 'fill-extrusion-height': ['+', ['get', 'hm'], 0.6], 'fill-extrusion-vertical-gradient': true },
    },
  ];
}
