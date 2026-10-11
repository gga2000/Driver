import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { offsetMetres, pathMetres, slicePath, type LngLat } from './metres.js';
import { GOLDEN_FONTS } from './golden-style.js';
import type { GoldenLight } from './sun.js';

/**
 * "Closed streets" (N20, Ali approved 2026-10-11): field ops close a stretch of street for the day (works, a funeral,
 * water), and every map that shows a route draws it: the stretch in rust and cream stripes like the N6 slow stretch,
 * a barrier across each end and a short label. Routing and the promised time live on the server; this piece only draws.
 * The customer track route (`route.closures`) and the Console pass the same shape; the label text comes from the app so
 * the words stay in its i18n.
 */

/** What the piece needs of a closed street (the contract's `ClosedStreet` fits it as is). */
export interface ClosedStreetLike {
  id: string;
  path: readonly { lat: number; lng: number }[];
  reason?: string;
  nameAr?: string | null;
}

/** Rust, never alarm red, as the slow stretch; cream stripes over it. */
const RUST = { day: '#9A3F1E', night: '#E07A4A' } as const;
const CREAM = { day: '#FBEFD9', night: '#2A1A0C' } as const;
/** The barrier across each end: as wide as a main street, so it reads as "blocked" at a glance. */
const BAR_M = 12;

/** The barrier line across the street at `at`, square to the street's direction there. */
function barAcross(at: LngLat, towards: LngLat): LngLat[] {
  const lat = (at[1] * Math.PI) / 180;
  const east = (towards[0] - at[0]) * 111320 * Math.cos(lat);
  const north = (towards[1] - at[1]) * 110540;
  const len = Math.hypot(east, north) || 1;
  const [px, py] = [-north / len, east / len];
  return [offsetMetres(at, (px * BAR_M) / 2, (py * BAR_M) / 2), offsetMetres(at, (-px * BAR_M) / 2, (-py * BAR_M) / 2)];
}

/**
 * The closed streets as GeoJSON: per street its stretch (`part: 'closed'`), a barrier across each end (`'bar'`), an end
 * dot (`'end'`) and a label point mid-stretch (`'label'`, text from `labelOf`, e.g. «مسدود اليوم · تصليح ماي»).
 * A street with fewer than two points is left out.
 */
export function closedStreetsGeoJSON(streets: readonly ClosedStreetLike[], labelOf: (s: ClosedStreetLike) => string) {
  const features: { type: 'Feature'; properties: Record<string, string>; geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Point'; coordinates: LngLat } }[] = [];
  for (const s of streets) {
    const path: LngLat[] = s.path.map((p) => [p.lng, p.lat]);
    if (path.length < 2) continue;
    const a = path[0]!, b = path[path.length - 1]!;
    features.push({ type: 'Feature', properties: { part: 'closed', id: s.id }, geometry: { type: 'LineString', coordinates: path } });
    features.push({ type: 'Feature', properties: { part: 'bar', id: s.id }, geometry: { type: 'LineString', coordinates: barAcross(a, path[1]!) } });
    features.push({ type: 'Feature', properties: { part: 'bar', id: s.id }, geometry: { type: 'LineString', coordinates: barAcross(b, path[path.length - 2]!) } });
    features.push({ type: 'Feature', properties: { part: 'end', id: s.id }, geometry: { type: 'Point', coordinates: a } });
    features.push({ type: 'Feature', properties: { part: 'end', id: s.id }, geometry: { type: 'Point', coordinates: b } });
    const total = pathMetres(path).at(-1)!;
    const half = slicePath(path, 0, total / 2);
    features.push({ type: 'Feature', properties: { part: 'label', id: s.id, label: labelOf(s) }, geometry: { type: 'Point', coordinates: half[half.length - 1] ?? a } });
  }
  return { type: 'FeatureCollection' as const, features };
}

/**
 * The closed streets' layers, added after the route's layers and before `GOLDEN_FIRST_LABEL`: a rust casing with cream
 * stripes, a striped barrier across each end with a cream dot, and the label with a halo. Nothing moves; a new closure
 * just appears with the next data.
 */
export function closedStreetsLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'closed';
  const night = opts.light === 'night';
  const rust = night ? RUST.night : RUST.day;
  const cream = night ? CREAM.night : CREAM.day;
  const width = (lo: number, hi: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 13, lo, 18, hi] as never;
  const is = (part: string) => ['==', ['get', 'part'], part] as never;
  return [
    { id: `${id}-casing`, type: 'line', source: opts.source, filter: is('closed'), layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': rust, 'line-width': width(4, 13) } },
    { id: `${id}-stripes`, type: 'line', source: opts.source, filter: is('closed'), layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': cream, 'line-width': width(2.2, 8), 'line-dasharray': [0.7, 0.7] } },
    { id: `${id}-bar`, type: 'line', source: opts.source, filter: is('bar'), layout: { 'line-cap': 'round' }, paint: { 'line-color': rust, 'line-width': width(3, 8) } },
    { id: `${id}-bar-stripes`, type: 'line', source: opts.source, filter: is('bar'), layout: { 'line-cap': 'butt' }, paint: { 'line-color': cream, 'line-width': width(1.4, 4), 'line-dasharray': [1, 1] } },
    { id: `${id}-end`, type: 'circle', source: opts.source, filter: is('end'), paint: { 'circle-radius': width(3, 7), 'circle-color': cream, 'circle-stroke-color': rust, 'circle-stroke-width': 2.5 } },
    {
      id: `${id}-label`, type: 'symbol', source: opts.source, filter: is('label'),
      layout: { 'text-field': ['get', 'label'], 'text-font': [...GOLDEN_FONTS.bold], 'text-size': 13, 'text-offset': [0, -1.6], 'text-allow-overlap': true },
      paint: { 'text-color': night ? '#FBEFD9' : '#5A1E08', 'text-halo-color': night ? '#120D09' : '#FFFCF6', 'text-halo-width': 2.2 },
    },
  ];
}
