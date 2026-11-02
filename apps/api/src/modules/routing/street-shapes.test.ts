import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { buildStreetGraph, type LngLat } from '@driver/map/pieces/street-route';
import { EtaService } from './eta.service.js';
import { decodePolyline, encodePolyline } from './polyline.js';
import type { RouteResult, Router } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';
import { StreetShapes, townStreets } from './street-shapes.js';

// Three streets ~100 m apart running east, joined by three running north (a block grid).
const X = [45.06, 45.061, 45.062];
const Y = [32.9, 32.9009, 32.9018];
const grid = buildStreetGraph([...Y.map((y) => ({ coords: X.map((x): LngLat => [x, y]) })), ...X.map((x) => ({ coords: Y.map((y): LngLat => [x, y]) }))]);
const at = (lng: number, lat: number): LatLng => ({ lat, lng });
const onGrid = (p: LatLng) => X.some((x) => Math.abs(p.lng - x) < 1e-6) || Y.some((y) => Math.abs(p.lat - y) < 1e-6);

describe('EtaService.path with street shapes', () => {
  const eta = new EtaService(new StraightLineRouter(), undefined, new StreetShapes(() => grid));

  it('draws the straight estimate along the streets, keeping its distance, time and basis', async () => {
    const from = at(45.06, 32.9);
    const to = at(45.062, 32.9018);
    const plain = await new StraightLineRouter().route([from, to]);
    const r = await eta.path([from, to]);
    expect(r).toMatchObject({ distanceM: plain.distanceM, durationS: plain.durationS, basis: 'estimated' });
    const line = decodePolyline(r.polyline6!);
    expect(line[0]).toEqual(from);
    expect(line[line.length - 1]).toEqual(to);
    expect(line.length).toBeGreaterThanOrEqual(3);
    for (const p of line) expect(onGrid(p)).toBe(true);
  });

  it('never changes minutes: they come from the router alone', async () => {
    const plain = new EtaService(new StraightLineRouter());
    expect(await eta.minutes(at(45.06, 32.9), at(45.062, 32.9018), 'bike')).toEqual(await plain.minutes(at(45.06, 32.9), at(45.062, 32.9018), 'bike'));
  });

  it('goes through every stop in order (courier → kitchen → door)', async () => {
    const line = decodePolyline((await eta.path([at(45.06, 32.9), at(45.062, 32.9), at(45.062, 32.9018)])).polyline6!);
    expect(line.some((p) => Math.abs(p.lng - 45.062) < 1e-6 && Math.abs(p.lat - 32.9) < 1e-6)).toBe(true);
  });

  it('follows a bent line around a closure through its bends, keeping what it avoided', async () => {
    const bent: Router = {
      route: async (): Promise<RouteResult> => ({ distanceM: 500, durationS: 60, polyline6: encodePolyline([at(45.06, 32.9), at(45.06, 32.9018), at(45.062, 32.9018)]), basis: 'estimated', avoided: [{ id: 'c1', extraS: 30 }] }),
      table: async () => ({ durationsS: [], distancesM: [], basis: 'estimated' }),
    };
    const r = await new EtaService(bent, undefined, new StreetShapes(() => grid)).path([at(45.06, 32.9), at(45.062, 32.9018)]);
    expect(r).toMatchObject({ distanceM: 500, durationS: 60, avoided: [{ id: 'c1', extraS: 30 }] });
    expect(decodePolyline(r.polyline6!).some((p) => Math.abs(p.lng - 45.06) < 1e-6 && Math.abs(p.lat - 32.9018) < 1e-6)).toBe(true);
  });

  it('keeps a road shape OSRM already gave', async () => {
    const osrm: Router = { route: async (): Promise<RouteResult> => ({ distanceM: 1, durationS: 1, polyline6: 'abc', basis: 'road' }), table: async () => ({ durationsS: [], distancesM: [], basis: 'road' }) };
    expect((await new EtaService(osrm, undefined, new StreetShapes(() => grid)).path([at(45.06, 32.9), at(45.062, 32.9018)])).polyline6).toBe('abc');
  });

  it('leaves the line straight when an end is off the street map', async () => {
    expect((await eta.path([at(45.06, 32.9), at(45.2, 33.0)])).polyline6).toBeNull();
  });

  it('ends a remembered shape at the exact points asked for', async () => {
    await eta.path([at(45.06, 32.9), at(45.062, 32.9018)]);
    const near = at(45.06001, 32.90001);
    const line = decodePolyline((await eta.path([near, at(45.062, 32.9018)])).polyline6!);
    expect(line[0]).toEqual(near);
  });
});

describe('the town streets', () => {
  it('route a kitchen to a door in the middle of Aziziyah along the streets', () => {
    const s = new StreetShapes(townStreets).shape([at(45.0588, 32.9088), at(45.0628, 32.9058)]);
    expect(s).not.toBeNull();
    expect(decodePolyline(s!).length).toBeGreaterThan(5);
  });
});
