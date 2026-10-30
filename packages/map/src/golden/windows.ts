import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { GOLDEN_PALETTES } from './palettes.js';
import type { GoldenLight } from './sun.js';

/**
 * Windows, doors and roof walls on the houses up close (map audit, 2026-10-12; Ali picked it 21:56Z). Too many
 * pieces to ship in the tiles, so the app builds them on the phone for the houses on screen only, from the tiles'
 * own house shapes: `housesFromFeatures` picks the nearest houses from what the map already has loaded, then
 * `houseWindows` puts on each one
 * - a low wall (0.6 m) around the flat roof, in the house's own finish;
 * - a row of windows on every wall long enough, one row per storey, each under a pale sill;
 * - a painted metal door on the longest wall (brown, green, maroon or grey; never blue);
 * and `windowLayers` draws them from z17. At night the windows of lit homes glow, a third of them.
 * Cheap phones (`lite`) skip it, as they skip the 3D houses.
 */
type LngLat = [number, number];
export interface WindowHouse {
  /** The house outline (outer ring, lng/lat). */
  ring: readonly LngLat[];
  /** Height in metres, as the tiles carry it (3.6 / 6.8 / 10). */
  hm: number;
  /** The roof finish, 0–5 (`tone` in the tiles). */
  tone?: number;
  /** A home with its lights on at night (`lit` in the tiles). */
  lit?: boolean;
}

export const WINDOW_SOURCE = 'golden-windows';
/** Zoom where the windows and doors come in: below it they are a few pixels and only cost. */
export const WINDOW_MINZOOM = 17;
/** At most this many houses at a time, the nearest to the middle of the screen. */
export const WINDOW_MAX_HOUSES = 220;

const STOREY_M = 3.4;
const WINDOW_EVERY_M = 2.8;
const MIN_WALL_M = 3;
const DOOR_COLOURS = 4;

const mPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const M_PER_LAT = 110540;
const hash = (x: number, y: number) => {
  let h = Math.imul(Math.round(x * 1e6) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 1e6), 0xc2b2ae35);
  h ^= h >>> 15;
  return Math.abs(Math.imul(h, 0x27d4eb2f) ^ (h >>> 13));
};

type Piece = Feature<Polygon, { k: 'win' | 'sill' | 'door' | 'parapet'; b: number; t: number; lit?: 0 | 1; c?: number; tone?: number }>;

/** The windows, doors and roof walls for these houses, as one FeatureCollection for `WINDOW_SOURCE`. */
export function houseWindows(houses: readonly WindowHouse[]): FeatureCollection<Polygon> {
  const out: Piece[] = [];
  for (const house of houses) {
    const ring = house.ring[0]?.[0] === house.ring.at(-1)?.[0] && house.ring[0]?.[1] === house.ring.at(-1)?.[1] ? house.ring.slice(0, -1) : house.ring.slice();
    if (ring.length < 3) continue;
    const lat0 = ring[0]![1];
    const lng0 = ring[0]![0];
    const kx = mPerLng(lat0);
    // to metres around the first corner, counter-clockwise so "outward" is always to the right of a wall
    let pts = ring.map(([x, y]) => [(x - lng0) * kx, (y - lat0) * M_PER_LAT] as [number, number]);
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    if (area2 < 0) pts = pts.reverse();
    if (Math.abs(area2) / 2 < 12) continue;
    const back = ([x, y]: [number, number]): LngLat => [lng0 + x / kx, lat0 + y / M_PER_LAT];
    const quad = (cx: number, cy: number, ux: number, uy: number, half: number, out0: number, out1: number): Polygon => {
      const nx = uy;
      const ny = -ux;
      const c: [number, number][] = [
        [cx - ux * half + nx * out0, cy - uy * half + ny * out0],
        [cx + ux * half + nx * out0, cy + uy * half + ny * out0],
        [cx + ux * half + nx * out1, cy + uy * half + ny * out1],
        [cx - ux * half + nx * out1, cy - uy * half + ny * out1],
      ];
      return { type: 'Polygon', coordinates: [[...c.map(back), back(c[0]!)]] };
    };
    const hm = house.hm;
    const tone = house.tone ?? 0;
    const seed = hash(lng0, lat0);
    const floors = Math.max(1, Math.round(hm / STOREY_M));
    const walls = pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    });
    const longest = walls.reduce((m, w, i) => (w.len > walls[m]!.len ? i : m), 0);
    walls.forEach(({ a, b, len }, wi) => {
      // the roof wall runs along every edge, sitting just inside it
      if (len >= 0.5) {
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        out.push({ type: 'Feature', properties: { k: 'parapet', b: hm, t: hm + 0.6, tone }, geometry: quad((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ux, uy, len / 2, -0.25, 0) });
      }
      if (len < MIN_WALL_M) return;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const n = Math.floor((len - 1.2) / WINDOW_EVERY_M);
      if (n < 1) return;
      const start = (len - (n - 1) * WINDOW_EVERY_M) / 2;
      const doorAt = wi === longest ? Math.floor(n / 2) : -1;
      for (let f = 0; f < floors; f++) {
        for (let i = 0; i < n; i++) {
          const d = start + i * WINDOW_EVERY_M;
          const cx = a[0] + ux * d;
          const cy = a[1] + uy * d;
          if (f === 0 && i === doorAt) {
            out.push({ type: 'Feature', properties: { k: 'door', b: 0, t: 2.3, c: seed % DOOR_COLOURS }, geometry: quad(cx, cy, ux, uy, 0.65, -0.05, 0.35) });
            continue;
          }
          const base = f * STOREY_M + 1.1;
          const lit = house.lit && ((seed >>> ((i + f) % 24)) & 3) === 0 ? 1 : 0;
          out.push({ type: 'Feature', properties: { k: 'win', b: base, t: base + 1.25, lit }, geometry: quad(cx, cy, ux, uy, f ? 0.55 : 0.5, -0.05, 0.3) });
          out.push({ type: 'Feature', properties: { k: 'sill', b: base + 1.25, t: base + 1.38 }, geometry: quad(cx, cy, ux, uy, f ? 0.67 : 0.62, -0.05, 0.42) });
        }
      }
    });
  }
  return { type: 'FeatureCollection', features: out };
}

type AnyGeom = { type: string; coordinates: unknown };
interface SourceFeature {
  geometry: AnyGeom | null;
  properties?: Record<string, unknown> | null;
}

/**
 * The houses to dress, from features the map already has loaded (`map.querySourceFeatures(GOLDEN_SOURCE,
 * { sourceLayer: 'buildings' })` on the web; the vector source's `features()` on the phone): houses only, each once
 * (tiles repeat a house along their edges), the nearest `max` to `centre`.
 */
export function housesFromFeatures(features: readonly SourceFeature[], centre: LngLat, max = WINDOW_MAX_HOUSES): WindowHouse[] {
  const seen = new Set<string>();
  const found: { house: WindowHouse; d: number }[] = [];
  const kx = mPerLng(centre[1]);
  for (const f of features) {
    const p = f.properties ?? {};
    if (p.kind !== 'house' || !f.geometry) continue;
    const rings = f.geometry.type === 'Polygon' ? [(f.geometry.coordinates as LngLat[][])[0]] : f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as LngLat[][][]).map((q) => q[0]) : [];
    for (const ring of rings) {
      if (!ring || ring.length < 4) continue;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of ring) {
        sx += x;
        sy += y;
      }
      const c: LngLat = [sx / ring.length, sy / ring.length];
      const key = `${c[0].toFixed(5)},${c[1].toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = Math.hypot((c[0] - centre[0]) * kx, (c[1] - centre[1]) * M_PER_LAT);
      found.push({ house: { ring, hm: Number(p.hm) || 3.6, tone: Number(p.tone) || 0, lit: p.lit === 1 }, d });
    }
  }
  return found.sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.house);
}

/** The layer that draws `WINDOW_SOURCE`; add it before `GOLDEN_FIRST_LABEL`. */
export function windowLayers(light: GoldenLight): LayerSpecification[] {
  const p = GOLDEN_PALETTES[light];
  const night = p.windowGlow !== null;
  const t = p.roofTones;
  const fade = ['interpolate', ['linear'], ['zoom'], WINDOW_MINZOOM, 0, WINDOW_MINZOOM + 0.4, 1];
  return [
    {
      id: 'golden-windows', type: 'fill-extrusion', source: WINDOW_SOURCE, minzoom: WINDOW_MINZOOM,
      paint: {
        'fill-extrusion-color': [
          'match', ['get', 'k'],
          'parapet', ['match', ['get', 'tone'], 0, t[0], 1, t[1], 2, t[2], 3, t[3], 4, t[4], t[5]],
          'sill', night ? p.wall : '#F4EAD6',
          'door', ['match', ['get', 'c'], 0, night ? '#2A1A10' : '#6B4426', 1, night ? '#1A2214' : '#3F5A32', 2, night ? '#2A1210' : '#7A2E24', night ? '#201812' : '#4E4238'],
          night ? ['case', ['==', ['get', 'lit'], 1], p.windowGlow!, '#1E1712'] : '#4A3A2C',
        ] as never,
        'fill-extrusion-base': ['get', 'b'] as never,
        'fill-extrusion-height': ['get', 't'] as never,
        'fill-extrusion-opacity': fade as never,
      },
    },
  ];
}
