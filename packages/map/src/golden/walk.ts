import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Road } from './life.js';
import { metresBetween, nearestOnSegment, type LngLat } from './metres.js';
import type { GoldenLight } from './sun.js';

/**
 * "Walk to where the car can stop" (N10, Ali 2026-10-11): when a ride pickup pin sits deep in an alley, offer a short
 * walk to a safe stop on a main road by a landmark everyone knows, so the car comes faster and never reverses down a
 * lane. Pure: the screen passes the streets it has on screen (`roadsFromFeatures`) and the landmarks it already loads.
 */

/** The road classes a car can stop on safely (the rest are lanes and alleys). */
const STOP_ROADS: ReadonlySet<string> = new Set(['mid', 'major', 'highway']);
/** Already this close to a main road: no walk to offer. */
const NEAR_MAIN_M = 25;
/** A landmark this close to the stop names it («قبال الجامع الكبير»). */
const LANDMARK_NAME_M = 80;
/** The one-time draw of the dotted walk, then it holds. */
export const WALK_DRAW_MS = 1500;

/** Map features from the tiles' `roads` layer (querySourceFeatures / queryRenderedFeatures) as streets. */
export function roadsFromFeatures(features: readonly unknown[]): Road[] {
  const out: Road[] = [];
  for (const f of features as { properties?: Record<string, unknown> | null; geometry?: { type: string; coordinates: unknown } }[]) {
    const cls = String(f.properties?.cls ?? '');
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push({ cls, coords: g.coordinates as LngLat[] });
    else if (g.type === 'MultiLineString') for (const line of g.coordinates as LngLat[][]) out.push({ cls, coords: line });
  }
  return out;
}

export interface SafeStop {
  stop: LngLat;
  /** The landmark the stop sits by, if one is close (the line says «قبال …»). */
  landmarkName: string | null;
  walkM: number;
}

/**
 * The nearest safe stop on a main road for a pickup pin, or null when the pin is already by one (within 25 m) or none is
 * within `maxWalkM` (250 m). Prefers a stop by a landmark when it costs under 40 m more walking.
 */
export function safeStopFor(
  pin: LngLat,
  roads: readonly Road[],
  landmarks: readonly { name: string; at: LngLat }[],
  opts: { maxWalkM?: number } = {},
): SafeStop | null {
  const maxWalk = opts.maxWalkM ?? 250;
  let best: { at: LngLat; m: number } | null = null;
  for (const r of roads) {
    if (!STOP_ROADS.has(r.cls)) continue;
    for (let i = 1; i < r.coords.length; i++) {
      const n = nearestOnSegment(pin, r.coords[i - 1]!, r.coords[i]!);
      if (!best || n.m < best.m) best = n;
    }
  }
  if (!best || best.m <= NEAR_MAIN_M || best.m > maxWalk) return null;
  // a stop by a landmark is easier to find for both: take it when the walk is not much longer
  let byLandmark: { at: LngLat; m: number; name: string } | null = null;
  for (const l of landmarks) {
    for (const r of roads) {
      if (!STOP_ROADS.has(r.cls)) continue;
      for (let i = 1; i < r.coords.length; i++) {
        const n = nearestOnSegment(l.at, r.coords[i - 1]!, r.coords[i]!);
        if (n.m > LANDMARK_NAME_M) continue;
        const walk = metresBetween(pin, n.at);
        if (walk <= maxWalk && walk <= best.m + 40 && (!byLandmark || walk < byLandmark.m)) byLandmark = { at: n.at, m: walk, name: l.name };
      }
    }
  }
  if (byLandmark) return { stop: byLandmark.at, landmarkName: byLandmark.name, walkM: Math.round(byLandmark.m) };
  return { stop: best.at, landmarkName: null, walkM: Math.round(best.m) };
}

/**
 * The walk as a line plus the stop. `k` (0–1) draws it from the pin towards the stop: step it once over WALK_DRAW_MS,
 * then leave it out (drawn, at rest; also the reduce-motion state). The dots are a dash pattern, so the draw trims the
 * line itself (MapLibre turns line gradients off on dashed lines).
 */
export function walkToStopGeoJSON(from: LngLat, to: LngLat, k?: number) {
  const t = k === undefined ? 1 : Math.max(0, Math.min(1, k));
  const end: LngLat = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...(t > 0 ? [{ type: 'Feature' as const, properties: { part: 'walk' }, geometry: { type: 'LineString' as const, coordinates: [from, end] } }] : []),
      { type: 'Feature' as const, properties: { part: 'stop' }, geometry: { type: 'Point' as const, coordinates: to } },
    ],
  };
}

/** The walk's colours: dark ink dots on a pale halo by day, warm cream dots at night (no blue or teal). */
export function walkColours(light: GoldenLight): { dot: string; halo: string; stop: string } {
  return light === 'night' ? { dot: '#FBEFD9', halo: '#120D09', stop: '#E08A1E' } : { dot: '#2A1A0C', halo: '#FFFCF6', stop: '#E08A1E' };
}

/** The walk's layers (a dotted line and the stop's saffron dot), added before `GOLDEN_FIRST_LABEL`. */
export function walkToStopLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'walk';
  const c = walkColours(opts.light);
  return [
    {
      id: `${id}-halo`, type: 'line', source: opts.source, filter: ['==', ['get', 'part'], 'walk'],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': c.halo, 'line-width': 7, 'line-opacity': 0.85 },
    },
    {
      id: `${id}-dots`, type: 'line', source: opts.source, filter: ['==', ['get', 'part'], 'walk'],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': c.dot, 'line-width': 3.5, 'line-dasharray': [0.1, 2.2] },
    },
    {
      id: `${id}-stop`, type: 'circle', source: opts.source, filter: ['==', ['get', 'part'], 'stop'],
      paint: { 'circle-radius': 7, 'circle-color': c.stop, 'circle-stroke-color': c.halo, 'circle-stroke-width': 3 },
    },
  ];
}
