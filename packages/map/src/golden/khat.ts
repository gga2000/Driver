import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { serviceInk, type MapService } from './routes.js';
import { pathMetres, slicePath, type LngLat } from './metres.js';
import type { GoldenLight } from './sun.js';

/**
 * "School route: only your home and the bus" (N14, Ali 2026-10-11): a guardian sees the bus, their own stop and the school.
 * Other children's stops are blank dots on the line with no names and no homes. They come in as fractions along the
 * route (`others`), never as coordinates, so another child's home never reaches this phone.
 */
export interface KhatRouteInput {
  route: readonly LngLat[];
  bus?: LngLat;
  school: LngLat;
  mine: LngLat;
  /** Other stops as 0–1 along the route: drawn as plain dots on the line. */
  others: readonly number[];
}

export function khatRouteGeoJSON(input: KhatRouteInput) {
  const cum = pathMetres(input.route);
  const total = cum[cum.length - 1] ?? 0;
  const point = (part: string, at: LngLat) => ({ type: 'Feature' as const, properties: { part }, geometry: { type: 'Point' as const, coordinates: at } });
  const features: object[] = [];
  if (input.route.length >= 2) features.push({ type: 'Feature' as const, properties: { part: 'route' }, geometry: { type: 'LineString' as const, coordinates: input.route } });
  for (const f of input.others) {
    if (!(f > 0 && f < 1) || !total) continue;
    const at = slicePath(input.route, 0, f * total).at(-1);
    if (at) features.push(point('other', at));
  }
  features.push(point('school', input.school), point('mine', input.mine));
  if (input.bus) features.push(point('bus', input.bus));
  return { type: 'FeatureCollection' as const, features };
}

/** The route in the خطوط colour, plain dots for the other stops; your stop, the school and the bus are pins the screen draws. */
export function khatRouteLayers(opts: { source: string; light: GoldenLight; id?: string; service?: MapService }): LayerSpecification[] {
  const id = opts.id ?? 'khat';
  // خطوط has no service colour of its own yet: the route defaults to the trips' gold, the screen may pass another
  const ink = serviceInk(opts.service ?? 'back', opts.light);
  const part = (p: string) => ['==', ['get', 'part'], p] as never;
  return [
    { id: `${id}-casing`, type: 'line', source: opts.source, filter: part('route'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink.edge, 'line-width': 8, 'line-opacity': 0.85 } },
    { id: `${id}-route`, type: 'line', source: opts.source, filter: part('route'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink.route, 'line-width': 5 } },
    { id: `${id}-others`, type: 'circle', source: opts.source, filter: part('other'), paint: { 'circle-radius': 4.5, 'circle-color': ink.ring, 'circle-stroke-color': ink.edge, 'circle-stroke-width': 1.5 } },
  ];
}
