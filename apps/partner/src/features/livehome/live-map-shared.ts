import type { DemandCell } from '@driver/map/pieces/demand';
import { LIVE_GLOW } from './FlatTownMap';
import { LIVE_ZOOM_MAX, type DayStop } from './pulse-logic';
import { streetRoute, type LngLat as Pt, type StreetGraph } from './street-route';

/** What the 3D live map (web and phones) shares: its camera, its motion clock and the shapes it draws. */

/** Close, tilted, from the south-east like the concept. */
export const CAM = { zoom: LIVE_ZOOM_MAX, pitch: 58, bearing: 330 };
/** One slow quarter-ish turn when the home opens, then still. */
export const TURN_DEG = 28;
export const TURN_MS = 30_000;
/** Cars and people move this long after the home opens, then park (battery: the home stays open all shift). */
export const LIFE_MS = 45_000;
/** A ripple widens over this long. */
export const RIPPLE_MS = 2_400;
export const RISE_MS = 2_600;
/** «يومي»: the whole day from a little higher and almost north-up. */
export const DAY_CAM = { pitch: 30, bearing: -8, maxZoom: 16.5 };

export const SRC = { glow: 'live-glow', ripples: 'live-ripples', trail: 'live-trail', life: 'live-life' } as const;
export const EMPTY = { type: 'FeatureCollection' as const, features: [] as never[] };

/** He stays in the lower-middle of the map even when the bottom cards are tall (the map shows over them). */
export function livePadding(height: number, top: number, bottom: number) {
  return { top: Math.min(top, height * 0.22), bottom: Math.min(bottom, height * 0.3), left: 0, right: 0 };
}

/** Where the opening turn is at time `now` (ms, same clock as `turnStart`); 0 = no turn (reduce motion). */
export function turnBearing(turnStart: number, now: number): number {
  return CAM.bearing + (turnStart ? TURN_DEG * Math.min(1, Math.max(0, (now - turnStart) / TURN_MS)) : 0);
}

const kx = 111_320 * Math.cos((32.9 * Math.PI) / 180);
const ky = 110_540;

/** A zone's faint glow as stacked discs (as the courier map draws N17), at the live home's strength. */
export function glowRings(cells: readonly DemandCell[]) {
  const ring = ([lng, lat]: readonly [number, number], r: number) =>
    Array.from({ length: 41 }, (_, i) => {
      const a = ((i % 40) / 40) * Math.PI * 2;
      return [lng + (Math.cos(a) * r) / kx, lat + (Math.sin(a) * r) / ky] as [number, number];
    });
  return {
    type: 'FeatureCollection' as const,
    features: cells.flatMap((c) =>
      [1, 0.8, 0.6, 0.4, 0.2].map((step) => ({
        type: 'Feature' as const,
        properties: { w: Math.min(1, c.weight * LIVE_GLOW) * (0.15 + 0.2 * (1 - step)) },
        geometry: { type: 'Polygon' as const, coordinates: [ring(c.at, 560 * (0.55 + 0.45 * c.weight) * step)] },
      })),
    ),
  };
}

/** Each delivery as a way along the streets when the map has them, else a straight line. */
export function dayLines(day: readonly DayStop[], graph: StreetGraph | null): Pt[][] {
  return day.flatMap((s) => {
    if (!s.pickup || !s.dropoff) return [];
    const a: Pt = [s.pickup.lng, s.pickup.lat];
    const b: Pt = [s.dropoff.lng, s.dropoff.lat];
    const r = graph ? streetRoute(graph, a, b) : null;
    return [r ? [a, ...r.path, b] : [a, b]];
  });
}

/** The box around every point drawn, [[west, south], [east, north]], or null when there is none. */
export function boundsOf(pts: readonly Pt[]): [Pt, Pt] | null {
  if (pts.length === 0) return null;
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    s = Math.min(s, y);
    e = Math.max(e, x);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** A ripple at `t` ms after it starts: its radius (px) and opacity. Reduce motion: one still ring. */
export function rippleAt(t: number, reduce: boolean) {
  const a = reduce ? 0.5 : Math.min(1, t / RIPPLE_MS);
  return { r: 6 + a * 70, o: 1 - a };
}

/** The ripple layers (a soft disc and a ring), under the street names. */
export function rippleLayers(night: boolean) {
  const ink = night ? '#FFB04A' : '#E07A10';
  return [
    { id: 'live-ripples-fill', type: 'circle' as const, source: SRC.ripples, paint: { 'circle-radius': ['*', ['get', 'r'], 0.55], 'circle-color': ink, 'circle-opacity': ['*', ['get', 'o'], 0.25], 'circle-blur': 0.6, 'circle-pitch-alignment': 'map' } },
    { id: 'live-ripples', type: 'circle' as const, source: SRC.ripples, paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ink, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': ['get', 'o'], 'circle-pitch-alignment': 'map' } },
  ];
}

/** «يومي»'s line: a wide soft glow and a saffron line that warms towards each door. */
export function trailLayers(night: boolean) {
  return [
    { id: 'live-trail-glow', type: 'line' as const, source: SRC.trail, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F38A1B', 'line-width': 14, 'line-opacity': 0.22, 'line-blur': 6 } },
    { id: 'live-trail', type: 'line' as const, source: SRC.trail, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, night ? '#8A5A20' : '#F2C27A', 1, '#E07A10'] } },
  ];
}
