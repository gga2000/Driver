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

/** The first layer of the golden style that the route goes under in the "on the ground" look: the houses and roofs. */
export const TRACKING_UNDER_HOUSES = 'golden-roofs';
/** Id of the direction arrow drawn along the road ahead; register `trackingArrowImage()` under it. */
export const TRACKING_ARROW = 'track-arrow';

const ARROW = 24;

/**
 * The small chevron that walks along the road ahead, pointing the way he drives (east in the image;
 * the layer turns it with the line). Drawn without a canvas, like the palm pattern, so the same pixels
 * work in the browser, React Native and tests.
 */
export function trackingArrowImage(light: GoldenLight): { width: number; height: number; data: Uint8Array } {
  const edge = serviceInk('food', light).edge;
  const ink = [1, 3, 5].map((i) => parseInt(edge.slice(i, i + 2), 16));
  const data = new Uint8Array(ARROW * ARROW * 4);
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  for (let y = 0; y < ARROW; y++) {
    for (let x = 0; x < ARROW; x++) {
      const d = Math.min(seg(x + 0.5, y + 0.5, 8, 5, 16, 12), seg(x + 0.5, y + 0.5, 16, 12, 8, 19));
      const a = Math.max(0, Math.min(1, 2.6 - d)); // ~4 px stroke, antialiased
      const i = (y * ARROW + x) * 4;
      data[i] = ink[0]!;
      data[i + 1] = ink[1]!;
      data[i + 2] = ink[2]!;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: ARROW, height: ARROW, data };
}

/**
 * The order map's route "on the ground" (Ali 2026-11-01, look B): the same sources and parts as
 * `goldenTrackingLayers`, but the line lies on the street under the houses, so a house in front of it
 * hides it the way a real street is hidden, and the line no longer seems to float over the roofs.
 * - `under` (add before TRACKING_UNDER_HOUSES): the glow, the driven part in quiet grey, the cased
 *   line ahead (still `${id}-ahead`, so `glintGradient` works the same) and small arrows the way he drives.
 * - `over` (add before GOLDEN_FIRST_LABEL): a faint dotted trace of the line through the houses that
 *   stand in front of it, so it always reads, and the lit building.
 * Register `trackingArrowImage(light)` as TRACKING_ARROW before adding the arrows.
 */
export function goldenTrackingGroundLayers(opts: {
  service: MapService;
  light: GoldenLight;
  routeSource: string;
  glowSource: string;
  litSource: string;
  id?: string;
}): { under: LayerSpecification[]; over: LayerSpecification[] } {
  const ink = serviceInk(opts.service, opts.light);
  const id = opts.id ?? 'track';
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const part = (p: string) => ['==', ['get', 'part'], p] as never;
  const cased = ['any', part('plan'), part('ahead')] as never;
  const width = (z15: number, z18: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 13, z15 * 0.6, 15, z15, 18, z18, 20, z18 * 1.6] as never;
  const [base] = goldenTrackingLayers(opts);
  return {
    under: [
      base!,
      { id: `${id}-done`, type: 'line', source: opts.routeSource, filter: part('done'), layout: round, paint: { 'line-color': ink.done, 'line-opacity': 0.85, 'line-width': width(3, 7) } },
      { id: `${id}-casing`, type: 'line', source: opts.routeSource, filter: cased, layout: round, paint: { 'line-color': ink.edge, 'line-opacity': 0.9, 'line-width': width(8, 20) } },
      { id: `${id}-plan`, type: 'line', source: opts.routeSource, filter: part('plan'), layout: round, paint: { 'line-color': ink.route, 'line-width': width(5, 13) } },
      { id: `${id}-ahead`, type: 'line', source: opts.routeSource, filter: part('ahead'), layout: round, paint: { 'line-width': width(5, 13), 'line-gradient': glintGradient(opts.service, opts.light, null) } },
      {
        id: `${id}-arrows`, type: 'symbol', source: opts.routeSource, filter: cased, minzoom: 14.5,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 15, 70, 18, 120] as never,
          'icon-image': TRACKING_ARROW, 'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.42, 18, 0.8] as never,
          'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.85 },
      },
    ],
    over: [
      { id: `${id}-through`, type: 'line', source: opts.routeSource, filter: cased, layout: round, paint: { 'line-color': ink.route, 'line-opacity': 0.4, 'line-width': width(2.5, 6), 'line-dasharray': [1, 1.6] } },
      ...goldenTrackingLayers(opts).filter((l) => l.id === `${id}-lit`),
    ],
  };
}
