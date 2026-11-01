import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { buildStreetGraph, type LngLat } from '@driver/map/pieces/street-route';
import { decodePolyline } from './polyline.js';
import { StraightLineRouter } from './straight-line.router.js';
import { StreetShapeRouter, townStreets } from './street-shape.router.js';
import type { RouteResult, Router } from './routing.port.js';

// Three streets ~100 m apart running east, joined by three running north (a block grid).
const X = [45.06, 45.061, 45.062];
const Y = [32.9, 32.9009, 32.9018];
const grid = buildStreetGraph([...Y.map((y) => ({ coords: X.map((x): LngLat => [x, y]) })), ...X.map((x) => ({ coords: Y.map((y): LngLat => [x, y]) }))]);
const at = (lng: number, lat: number): LatLng => ({ lat, lng });

describe('StreetShapeRouter', () => {
  const router = new StreetShapeRouter(new StraightLineRouter(), () => grid);

  it('draws the straight estimate along the streets, keeping its distance and time', async () => {
    const from = at(45.06, 32.9);
    const to = at(45.062, 32.9018);
    const plain = await new StraightLineRouter().route([from, to]);
    const r = await router.route([from, to]);
    expect(r).toMatchObject({ distanceM: plain.distanceM, durationS: plain.durationS, basis: 'estimated' });
    const line = decodePolyline(r.polyline6!);
    expect(line[0]).toEqual(from);
    expect(line[line.length - 1]).toEqual(to);
    // Round the block (three corners at most), never across it.
    expect(line.length).toBeGreaterThanOrEqual(3);
    for (const p of line) expect(X.some((x) => Math.abs(p.lng - x) < 1e-6) || Y.some((y) => Math.abs(p.lat - y) < 1e-6)).toBe(true);
  });

  it('goes through every stop in order (courier → kitchen → door)', async () => {
    const r = await router.route([at(45.06, 32.9), at(45.062, 32.9), at(45.062, 32.9018)]);
    const line = decodePolyline(r.polyline6!);
    expect(line.some((p) => Math.abs(p.lng - 45.062) < 1e-6 && Math.abs(p.lat - 32.9) < 1e-6)).toBe(true);
  });

  it('keeps a road shape the router underneath already has (OSRM)', async () => {
    const osrm: Router = { route: async (): Promise<RouteResult> => ({ distanceM: 1, durationS: 1, polyline6: 'abc', basis: 'road' }), table: async () => ({ durationsS: [], distancesM: [], basis: 'road' }) };
    expect((await new StreetShapeRouter(osrm, () => grid).route([at(45.06, 32.9), at(45.062, 32.9018)])).polyline6).toBe('abc');
  });

  it('leaves the line straight when an end is off the street map', async () => {
    expect((await router.route([at(45.06, 32.9), at(45.2, 33.0)])).polyline6).toBeNull();
  });

  it('ends a remembered shape at the exact points asked for', async () => {
    await router.route([at(45.06, 32.9), at(45.062, 32.9018)]);
    const near = at(45.06001, 32.90001);
    const line = decodePolyline((await router.route([near, at(45.062, 32.9018)])).polyline6!);
    expect(line[0]).toEqual(near);
  });
});

describe('the town streets', () => {
  it('route a kitchen to a door in the middle of Aziziyah along the streets', async () => {
    const r = await new StreetShapeRouter(new StraightLineRouter(), townStreets).route([at(45.0588, 32.9088), at(45.0628, 32.9058)]);
    expect(r.polyline6).not.toBeNull();
    expect(decodePolyline(r.polyline6!).length).toBeGreaterThan(5);
  });
});
