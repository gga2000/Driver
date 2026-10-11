import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { circleRing, type LngLat } from './metres.js';
import type { GoldenLight } from './sun.js';

/**
 * "Where the orders are now" (N17, Ali 2026-10-11): a waiting courier sees warm amber light over the parts of town with
 * the most orders, as advice he can ignore («القرار إلك»), never an order. Cells come from the server already aggregated
 * and delayed, so no single order or home shows. Amber, never red: it must not read as a disease map.
 */
export interface DemandCell {
  at: LngLat;
  /** 0–1, how busy the cell is. */
  weight: number;
}

/** Cells below this weight stay dark, so a quiet town shows nothing rather than noise. */
const MIN_WEIGHT = 0.15;

/** Each busy cell as a soft disc (radius grows a little with weight); `w` drives the colour and opacity. */
export function demandGlowGeoJSON(cells: readonly DemandCell[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cells
      .filter((c) => c.weight >= MIN_WEIGHT)
      .map((c) => {
        const w = Math.min(1, c.weight);
        return { type: 'Feature' as const, properties: { w }, geometry: { type: 'Polygon' as const, coordinates: [circleRing(c.at, 140 + 120 * w, 28)] } };
      }),
  };
}

/**
 * The glow's layer, under the streets' names. Updates cross-fade through MapLibre's own fill transition when the screen
 * swaps the data (about 2 s); nothing pulses.
 */
export function demandGlowLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const night = opts.light === 'night';
  return [
    {
      id: opts.id ?? 'demand-glow', type: 'fill', source: opts.source,
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'w'], 0, night ? '#8A5A20' : '#F2C27A', 1, night ? '#FFB04A' : '#E08A1E'],
        'fill-opacity': ['interpolate', ['linear'], ['get', 'w'], MIN_WEIGHT, 0.12, 1, night ? 0.42 : 0.34],
        'fill-opacity-transition': { duration: 2000, delay: 0 },
        'fill-antialias': false,
      },
    },
  ];
}
