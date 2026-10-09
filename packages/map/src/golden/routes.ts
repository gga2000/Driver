import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { services } from '@driver/design-tokens';
import type { GoldenLight } from './sun.js';

/** The services that draw a route or pins on the map, in their home-screen colours (design tokens). */
export type MapService = 'food' | 'taxi' | 'tuktuk' | 'trips' | 'back';

export interface ServiceInk {
  /** The route and the moving vehicle. */
  route: string;
  /** The thin dark edge that keeps a pale colour (taxi yellow) readable on cream streets. */
  edge: string;
  /** The part already driven: quiet, so the eye goes to what is ahead. */
  done: string;
  /** The ring around pins and the vehicle. */
  ring: string;
}

const DAY_EDGE = '#2A1A0C';
const NIGHT_EDGE = '#120D09';

/**
 * Route colours per service and light. By day the service's own fill on a dark edge; at night the
 * brighter `card.dot` of the dark theme, because the day fills of tuktuk plum and the trips' date
 * brown disappear into the night map.
 */
export function serviceInk(service: MapService, light: GoldenLight): ServiceInk {
  if (light === 'night') {
    return { route: services.dark[service].card.dot, edge: NIGHT_EDGE, done: '#5A4A3B', ring: '#FBEFD9' };
  }
  return { route: services.light[service].fill, edge: DAY_EDGE, done: '#B9A285', ring: '#FFFCF6' };
}

/** Feature properties the route and pin sources use. */
export interface RouteFeatureProps {
  /** Route lines: `done` (behind the vehicle) or `ahead`. */
  part?: 'done' | 'ahead';
}
export interface PinFeatureProps {
  /** `vehicle` (courier, taxi…), `from` (pickup or restaurant), `to` (the door). */
  role: 'vehicle' | 'from' | 'to';
}

const zoomWidth = (base: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 12, base * 0.55, 15, base, 18, base * 1.8] as never;

/**
 * Layers that draw one trip on the Golden hour map in the service's colour: the driven part quiet,
 * the road ahead in the service colour on a dark edge, then the two ends and the vehicle as rings
 * (white ring = the vehicle, the brand's moving dot). Add them before `GOLDEN_FIRST_LABEL`:
 * `for (const l of goldenRouteLayers({...})) map.addLayer(l, GOLDEN_FIRST_LABEL)`.
 * `routeSource` holds LineStrings with `part`; `pinSource` holds Points with `role`.
 */
export function goldenRouteLayers(opts: {
  service: MapService;
  light: GoldenLight;
  routeSource: string;
  pinSource: string;
  /** Prefix for layer ids, so two trips can share a map (default `route`). */
  id?: string;
}): LayerSpecification[] {
  const ink = serviceInk(opts.service, opts.light);
  const id = opts.id ?? 'route';
  const ahead = ['!=', ['get', 'part'], 'done'] as never;
  const done = ['==', ['get', 'part'], 'done'] as never;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const role = (r: PinFeatureProps['role']) => ['==', ['get', 'role'], r] as never;
  return [
    { id: `${id}-done`, type: 'line', source: opts.routeSource, filter: done, layout: round, paint: { 'line-color': ink.done, 'line-width': zoomWidth(4), 'line-dasharray': [0.1, 2] } },
    { id: `${id}-edge`, type: 'line', source: opts.routeSource, filter: ahead, layout: round, paint: { 'line-color': ink.edge, 'line-width': zoomWidth(10) } },
    { id: `${id}-line`, type: 'line', source: opts.routeSource, filter: ahead, layout: round, paint: { 'line-color': ink.route, 'line-width': zoomWidth(7) } },
    // The two ends: where it starts in the service colour, the door in ink, both ringed in paper.
    { id: `${id}-from`, type: 'circle', source: opts.pinSource, filter: role('from'), paint: { 'circle-radius': 7, 'circle-color': ink.route, 'circle-stroke-color': ink.edge, 'circle-stroke-width': 2 } },
    { id: `${id}-to`, type: 'circle', source: opts.pinSource, filter: role('to'), paint: { 'circle-radius': 7, 'circle-color': ink.edge, 'circle-stroke-color': ink.ring, 'circle-stroke-width': 3 } },
    // The vehicle: a soft halo, then the service colour inside a white ring.
    { id: `${id}-vehicle-halo`, type: 'circle', source: opts.pinSource, filter: role('vehicle'), paint: { 'circle-radius': 18, 'circle-color': ink.route, 'circle-opacity': 0.22, 'circle-blur': 0.4 } },
    { id: `${id}-vehicle`, type: 'circle', source: opts.pinSource, filter: role('vehicle'), paint: { 'circle-radius': 9, 'circle-color': ink.route, 'circle-stroke-color': ink.ring, 'circle-stroke-width': 3 } },
  ];
}
