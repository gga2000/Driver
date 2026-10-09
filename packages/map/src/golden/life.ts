import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GoldenLight } from './sun.js';

/**
 * Street life (Ali, 2026-10-09: "moving"): small cars, تكتك and people on the real streets, like a model
 * town. Rules that keep it calm and never confusing:
 * - only up close (`LIFE_MINZOOM`), where a car reads as a car; from further out they'd be noisy dots;
 * - never saffron or any service colour, so nothing is mistaken for the courier or a ride;
 * - cars keep to lanes or park at the kerb, people stay on the pavements; fewer at night, none on alleys;
 * - the caller passes `moving: false` on slow phones and when the person has switched motion off: the town
 *   is then a still scene (parked cars, standing people).
 *
 * Everything is worked out from the streets on screen (the `roads` tile layer) with a fixed seed, so the
 * same street always shows the same scene. `lifeFrame()` turns a scene into GeoJSON for a moment in time.
 */
export const LIFE_MINZOOM = 16.6;

type LngLat = [number, number];
interface Road {
  cls: string;
  coords: LngLat[];
}

export interface StreetLifeOptions {
  /** Same seed, same street scene. */
  seed?: number;
  light?: GoldenLight;
  /** False on slow phones and with reduce-motion: cars stay parked, people stand. */
  moving?: boolean;
}

interface Thing {
  at: LngLat;
  bearing: number;
  colour: string;
  kind: 'car' | 'tuk' | 'person';
}
interface Mover {
  path: LngLat[];
  lengthM: number;
  lane: number;
  dir: 1 | -1;
  startM: number;
  speedMps: number;
  colour: string;
  kind: 'car' | 'tuk';
}
interface Walker extends Thing {
  walk: 0 | 1 | -1;
}
export interface StreetLife {
  parked: Thing[];
  people: Walker[];
  movers: Mover[];
  moving: boolean;
}

// Half the drawn street width in metres at street-level zoom, per road class (the style's WIDTH at z18).
const HALF: Record<string, number> = { major: 5, mid: 3.5, minor: 1.6 };
// Mostly white and silver like Iraqi streets, one dark, one maroon; never saffron, yellow, blue or teal.
const CAR_COLOURS = ['#FBF8F1', '#FBF8F1', '#FBF8F1', '#FBF8F1', '#E2DFD8', '#E2DFD8', '#C9C3B8', '#8E2F22', '#EADCC0', '#5A524C'];
// Dishdasha white, abaya black, earth tones.
const PEOPLE_COLOURS = ['#FFFDF6', '#FFFDF6', '#FFFDF6', '#2B2622', '#2B2622', '#7A6A58', '#A0784E', '#55613F', '#8E2F22'];
const WALK_MPS = 1.3;

const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function offsetPoint(p: LngLat, ux: number, uy: number, sideM: number, alongM: number): LngLat {
  const kx = mPerDegLng(p[1]);
  return [p[0] + (ux * alongM + uy * sideM) / kx, p[1] + (uy * alongM - ux * sideM) / M_PER_DEG_LAT];
}

/** Builds the street scene for the roads on screen (`map.querySourceFeatures(GOLDEN_SOURCE, { sourceLayer: 'roads' })`). */
export function streetLife(roads: readonly Road[], opts: StreetLifeOptions = {}): StreetLife {
  const rand = rng(opts.seed ?? 7);
  const night = opts.light === 'night';
  const busy = night ? 0.35 : 1;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const parked: Thing[] = [];
  const people: Walker[] = [];
  const movers: Mover[] = [];
  for (const r of roads) {
    const half = HALF[r.cls];
    if (!half || r.coords.length < 2) continue;
    const big = r.cls !== 'minor';
    const step = big ? 9 : 14;
    let lengthM = 0;
    for (let i = 1; i < r.coords.length; i++) {
      const a = r.coords[i - 1]!;
      const b = r.coords[i]!;
      const kx = mPerDegLng(a[1]);
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
      const L = Math.hypot(dx, dy);
      if (L < 1) continue;
      lengthM += L;
      const ux = dx / L;
      const uy = dy / L;
      const bearing = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;
      for (let d = step * rand(); d < L; d += step) {
        for (const side of [1, -1] as const) {
          if (rand() < (big ? 0.28 : 0.1) * busy) {
            parked.push({ at: offsetPoint(a, ux, uy, side * (half - 1.1), d), bearing, colour: pick(CAR_COLOURS), kind: rand() < 0.12 ? 'tuk' : 'car' });
          }
          if (rand() < (big ? 0.32 : 0.12) * busy) {
            const walk = opts.moving !== false && rand() < 0.6 ? side : 0;
            people.push({ at: offsetPoint(a, ux, uy, side * (half + (big ? 1.6 : 1)), d), bearing: side > 0 ? bearing : (bearing + 180) % 360, colour: pick(PEOPLE_COLOURS), kind: 'person', walk });
          }
        }
      }
    }
    if (big && opts.moving !== false) {
      const n = Math.floor((lengthM / 110) * busy + rand());
      for (let i = 0; i < n; i++) {
        const dir = rand() < 0.5 ? 1 : -1;
        movers.push({ path: r.coords, lengthM, lane: dir * 1.6, dir, startM: rand() * lengthM, speedMps: 6 + rand() * 4, colour: pick(CAR_COLOURS), kind: rand() < 0.15 ? 'tuk' : 'car' });
      }
    }
  }
  return { parked, people, movers, moving: opts.moving !== false };
}

function moverAt(m: Mover, tSec: number): Thing {
  const total = m.lengthM || 1;
  let d = (((m.startM + m.speedMps * tSec) % total) + total) % total;
  if (m.dir < 0) d = total - d;
  const cs = m.path;
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1]!;
    const b = cs[i]!;
    const kx = mPerDegLng(a[1]);
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    const L = Math.hypot(dx, dy) || 1;
    if (d <= L || i === cs.length - 1) {
      const f = Math.min(1, d / L);
      const ux = dx / L;
      const uy = dy / L;
      let bearing = (Math.atan2(ux, uy) * 180) / Math.PI;
      if (m.dir < 0) bearing += 180;
      return { at: offsetPoint(a, ux, uy, m.lane, f * L), bearing: (bearing + 360) % 360, colour: m.colour, kind: m.kind };
    }
    d -= L;
  }
  return { at: cs[0]!, bearing: 0, colour: m.colour, kind: m.kind };
}

type Poly = { type: 'Feature'; properties: { colour: string; h: number; base: number }; geometry: { type: 'Polygon'; coordinates: LngLat[][] } };
function box(at: LngLat, bearing: number, lengthM: number, widthM: number, colour: string, base: number, h: number): Poly {
  const r = (bearing * Math.PI) / 180;
  const ux = Math.sin(r);
  const uy = Math.cos(r);
  const ring = ([[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]] as const).map(([a, s]) => offsetPoint(at, ux, uy, (s * widthM) / 2, (a * lengthM) / 2));
  return { type: 'Feature', properties: { colour, h, base }, geometry: { type: 'Polygon', coordinates: [ring] } };
}
function disc(at: LngLat, rM: number, colour: string, base: number, h: number): Poly {
  const kx = mPerDegLng(at[1]);
  const ring: LngLat[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = ((i % 8) * Math.PI) / 4 + Math.PI / 8;
    ring.push([at[0] + (Math.cos(a) * rM) / kx, at[1] + (Math.sin(a) * rM) / M_PER_DEG_LAT]);
  }
  return { type: 'Feature', properties: { colour, h, base }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** The scene at `tSec` seconds as one GeoJSON collection of small 3D blocks (cars: body + cabin, people: body + head). */
export function lifeFrame(life: StreetLife, tSec: number) {
  const features: Poly[] = [];
  const t = life.moving ? tSec : 0;
  for (const c of [...life.parked, ...life.movers.map((m) => moverAt(m, t))]) {
    if (c.kind === 'tuk') {
      features.push(box(c.at, c.bearing, 2.7, 1.35, '#7A2E1F', 0.25, 1), box(c.at, c.bearing, 1.9, 1.3, '#3B2A20', 1, 1.75));
    } else {
      features.push(box(c.at, c.bearing, 4.5, 1.8, c.colour, 0.2, 0.95), box(c.at, c.bearing, 2.3, 1.62, c.colour === '#5A524C' ? '#2E2A27' : '#5B5650', 0.95, 1.45));
    }
  }
  for (const p of life.people) {
    const r = (p.bearing * Math.PI) / 180;
    const at = p.walk ? offsetPoint(p.at, Math.sin(r), Math.cos(r), 0, WALK_MPS * t * p.walk) : p.at;
    features.push(disc(at, 0.42, p.colour, 0, 1.5), disc(at, 0.26, p.colour === '#2B2622' ? '#2B2622' : '#C08F63', 1.5, 1.95));
  }
  return { type: 'FeatureCollection' as const, features };
}

/** The one layer street life needs; add it before `GOLDEN_FIRST_LABEL` with a GeoJSON source fed by `lifeFrame()`. */
export function goldenLifeLayers(opts: { source: string; id?: string }): LayerSpecification[] {
  return [
    {
      id: opts.id ?? 'golden-life',
      type: 'fill-extrusion',
      source: opts.source,
      minzoom: LIFE_MINZOOM,
      paint: {
        'fill-extrusion-color': ['get', 'colour'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], LIFE_MINZOOM, 0, LIFE_MINZOOM + 0.6, 1],
      },
    },
  ];
}
