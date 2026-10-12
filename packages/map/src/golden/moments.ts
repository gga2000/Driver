import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { circleRing, slicePath, type LngLat } from './metres.js';
import { GOLDEN_FONTS } from './fonts.js';
import type { GoldenLight } from './sun.js';

/**
 * Small map moments for the order journey (Ali, 2026-10-11):
 * - N6 "Why it's late, on the map": the slow stretch of the route in deep rust stripes with a short label
 *   («زحمة السوق · 6 دقايق»), shown with the delay card the order sheet already has. No money rule changes here.
 * - N16 "The tablet sees the courier coming": the shop warms once when the courier is about 2 minutes out.
 */

/** Rust, never red alarm: the stretch reads as "slow here", not "danger". */
const RUST = { day: '#9A3F1E', night: '#E07A4A' } as const;

/** The slow stretch between `fromM` and `toM` metres along the route, and a point mid-stretch for its label. */
export function slowStretchGeoJSON(path: readonly LngLat[], fromM: number, toM: number, label: string) {
  const line = slicePath(path, fromM, toM);
  if (line.length < 2) return { type: 'FeatureCollection' as const, features: [] };
  const mid = slicePath(path, fromM, (fromM + toM) / 2);
  return {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { part: 'slow' }, geometry: { type: 'LineString' as const, coordinates: line } },
      { type: 'Feature' as const, properties: { part: 'label', label }, geometry: { type: 'Point' as const, coordinates: mid[mid.length - 1]! } },
    ],
  };
}

/**
 * The slow stretch's layers, added after the route's own layers and before `GOLDEN_FIRST_LABEL`: a rust casing with
 * cream stripes across it, and the label with a halo (IBM Plex Sans Arabic from the golden glyphs).
 */
export function slowStretchLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'slow';
  const night = opts.light === 'night';
  const rust = night ? RUST.night : RUST.day;
  return [
    { id: `${id}-casing`, type: 'line', source: opts.source, filter: ['==', ['get', 'part'], 'slow'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': rust, 'line-width': 9 } },
    { id: `${id}-stripes`, type: 'line', source: opts.source, filter: ['==', ['get', 'part'], 'slow'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': night ? '#2A1A0C' : '#FBEFD9', 'line-width': 5, 'line-dasharray': [0.6, 0.9] } },
    {
      id: `${id}-label`, type: 'symbol', source: opts.source, filter: ['==', ['get', 'part'], 'label'],
      layout: { 'text-field': ['get', 'label'], 'text-font': [...GOLDEN_FONTS.bold], 'text-size': 13, 'text-offset': [0, -1.6], 'text-allow-overlap': true },
      paint: { 'text-color': night ? '#FBEFD9' : '#2A1A0C', 'text-halo-color': night ? '#120D09' : '#FFFCF6', 'text-halo-width': 2 },
    },
  ];
}

/** The warm pool under a shop when its courier is close (one ring; the screen fades it in once, never pulses). */
export function shopWarmGeoJSON(at: LngLat) {
  return { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [circleRing(at, 14, 24)] } }] };
}

/** The warm pool's layer: saffron light on the ground, see-through. */
export function shopWarmLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  return [{ id: opts.id ?? 'shop-warm', type: 'fill', source: opts.source, paint: { 'fill-color': opts.light === 'night' ? '#FFB04A' : '#E08A1E', 'fill-opacity': opts.light === 'night' ? 0.32 : 0.22, 'fill-antialias': true } }];
}
