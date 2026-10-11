import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { boxRing, offsetMetres, type LngLat } from './metres.js';
import type { GoldenLight } from './sun.js';

export { GARAGE_BAYS } from './garage-bays.js';

/**
 * "Seats you can see at the garage" (N12, Ali 2026-10-11): over each car in the 3D garage floats a small bar of its seats,
 * free ones gold and taken ones date brown, so a rider sees at a glance which car is filling and books from it.
 * Cars stand where the garage model puts them (`GARAGE_BAYS`); the screen pairs each departure with a bay.
 */
export type GarageKey = 'bab1' | 'bab2' | 'souq';

export interface GarageCar {
  /** The departure id: every seat feature carries it, so a tap on the bar finds the car. */
  id: string;
  at: LngLat;
  bearing: number;
  seats: number;
  taken: number;
}

/** Seat blocks: 0.9 m each with a small gap, floating 3.6–4.3 m up (over the roof racks), along the car. */
const SEAT_M = 0.9;
const GAP_M = 0.25;
const BASE_M = 3.6;
const TOP_M = 4.3;

/** One small block per seat over each car, `free` 1 or 0; feature ids are stable per car and seat for tap hit-tests. */
export function garageSeatsGeoJSON(cars: readonly GarageCar[]) {
  const features = [];
  for (const c of cars) {
    const n = Math.max(0, Math.min(14, Math.round(c.seats)));
    const taken = Math.max(0, Math.min(n, Math.round(c.taken)));
    const r = (c.bearing * Math.PI) / 180;
    const ux = Math.sin(r), uy = Math.cos(r);
    const span = n * SEAT_M + (n - 1) * GAP_M;
    for (let i = 0; i < n; i++) {
      const along = -span / 2 + SEAT_M / 2 + i * (SEAT_M + GAP_M);
      const at = offsetMetres(c.at, ux * along, uy * along);
      features.push({
        type: 'Feature' as const,
        properties: { car: c.id, seat: i, free: i >= taken ? 1 : 0, base: BASE_M, hm: TOP_M },
        geometry: { type: 'Polygon' as const, coordinates: [boxRing(at, c.bearing, SEAT_M, SEAT_M * 0.8)] },
      });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}

/** Gold for a free seat, date brown for a taken one; brighter at night so the lot reads from the hall. */
export function garageSeatColours(light: GoldenLight): { free: string; taken: string } {
  return light === 'night' ? { free: '#FFC66E', taken: '#6B4A2E' } : { free: '#E5A53A', taken: '#7A4E2C' };
}

/** The seat bars' layer (3D blocks in the air), added before `GOLDEN_FIRST_LABEL`. */
export function garageSeatLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const c = garageSeatColours(opts.light);
  return [
    {
      id: opts.id ?? 'garage-seats', type: 'fill-extrusion', source: opts.source, minzoom: 16.5,
      paint: {
        'fill-extrusion-color': ['case', ['==', ['get', 'free'], 1], c.free, c.taken],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'hm'],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 16.5, 0, 17, 1],
      },
    },
  ];
}
