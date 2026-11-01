import { describe, expect, it } from 'vitest';
import { travelMinutes, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { EtaService } from './eta.service.js';
import { OsrmRouter, type OsrmFetch } from './osrm.router.js';
import { ResilientRouter, ROUTING_RULES } from './resilient.router.js';
import { routerFromEnv } from './routing.module.js';
import { RoutingUnavailable, type RouteResult, type Router, type TableResult } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';

const A: LatLng = { lat: 32.905, lng: 45.06 };
/** About `m` metres north of A. */
const north = (m: number): LatLng => ({ lat: A.lat + m / 111_195, lng: A.lng });

function fakeFetch(answer: (url: string) => { status: number; body: unknown } | Error): { fetch: OsrmFetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const a = answer(url);
      if (a instanceof Error) throw a;
      return { status: a.status, json: async () => a.body };
    },
  };
}

describe('StraightLineRouter', () => {
  it('1 km in a straight line is 1.4 km of road at 35 km/h, estimated', async () => {
    const r = await new StraightLineRouter().route([A, north(1_000)]);
    expect(r.distanceM).toBeCloseTo(1_400, -1);
    expect(r.durationS).toBeCloseTo(144, 0);
    expect(r).toMatchObject({ polyline6: null, basis: 'estimated' });
  });
});

describe('OsrmRouter', () => {
  it('asks for lng,lat with polyline6 and reads the first route', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { code: 'Ok', routes: [{ distance: 1830, duration: 210.5, geometry: 'abc' }] } }));
    const r = await new OsrmRouter('http://osrm:5000/', 1500, f.fetch).route([A, north(1_000)]);
    expect(f.urls[0]).toMatch(/^http:\/\/osrm:5000\/route\/v1\/driving\/45\.060000,32\.905000;45\.060000,32\.9139\d+\?overview=full&geometries=polyline6&steps=false$/);
    expect(r).toEqual({ distanceM: 1830, durationS: 210.5, polyline6: 'abc', basis: 'road' });
  });
  it('asks a table with sources then destinations', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { code: 'Ok', durations: [[60], [120]], distances: [[500], [1000]] } }));
    const t = await new OsrmRouter('http://osrm:5000', 1500, f.fetch).table([A, north(500)], [north(2_000)]);
    expect(f.urls[0]).toContain('?sources=0;1&destinations=2&annotations=duration,distance');
    expect(t).toEqual({ durationsS: [[60], [120]], distancesM: [[500], [1000]], basis: 'road' });
  });
  it('no route, server errors and timeouts become RoutingUnavailable', async () => {
    const noRoute = fakeFetch(() => ({ status: 400, body: { code: 'NoRoute' } }));
    await expect(new OsrmRouter('http://o', 1500, noRoute.fetch).route([A, north(10)])).rejects.toBeInstanceOf(RoutingUnavailable);
    const down = fakeFetch(() => ({ status: 503, body: {} }));
    await expect(new OsrmRouter('http://o', 1500, down.fetch).route([A, north(10)])).rejects.toThrow(/http 503/);
    const slow = fakeFetch(() => Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(new OsrmRouter('http://o', 1500, slow.fetch).route([A, north(10)])).rejects.toThrow(/timeout/);
  });
});

class ScriptedRouter implements Router {
  calls = 0;
  fail = false;
  async route(): Promise<RouteResult> {
    this.calls += 1;
    if (this.fail) throw new RoutingUnavailable('down');
    return { distanceM: 2_000, durationS: 300, polyline6: 'p', basis: 'road' };
  }
  async table(): Promise<TableResult> {
    this.calls += 1;
    if (this.fail) throw new RoutingUnavailable('down');
    return { durationsS: [[300]], distancesM: [[2_000]], basis: 'road' };
  }
}

describe('ResilientRouter', () => {
  it('caches answers on rounded coordinates for 10 minutes', async () => {
    const clock = new FakeClock('2026-10-05T10:00:00Z');
    const osrm = new ScriptedRouter();
    const r = new ResilientRouter(osrm, new StraightLineRouter(), clock);
    await r.route([A, north(1_000)]);
    await r.route([{ lat: A.lat + 0.00001, lng: A.lng }, north(1_000)]);
    expect(osrm.calls).toBe(1);
    clock.advance(ROUTING_RULES.cacheTtlMs);
    await r.route([A, north(1_000)]);
    expect(osrm.calls).toBe(2);
  });
  it('falls back to the straight line, and stops asking a failing OSRM for a minute', async () => {
    const clock = new FakeClock('2026-10-05T10:00:00Z');
    const osrm = new ScriptedRouter();
    osrm.fail = true;
    const r = new ResilientRouter(osrm, new StraightLineRouter(), clock);
    for (let i = 0; i < ROUTING_RULES.breakerFailures; i++) expect((await r.route([A, north(100 * (i + 1))])).basis).toBe('estimated');
    expect(r.open).toBe(true);
    await r.route([A, north(5_000)]);
    expect(osrm.calls).toBe(ROUTING_RULES.breakerFailures);
    osrm.fail = false;
    clock.advance(ROUTING_RULES.breakerOpenMs);
    expect((await r.route([A, north(5_000)])).basis).toBe('road');
  });
});

describe('EtaService', () => {
  it('without OSRM agrees with travelMinutes for a car, and scales per vehicle', async () => {
    const eta = new EtaService(new StraightLineRouter());
    const to = north(3_000);
    expect(Math.abs((await eta.minutes(A, to, 'car')).minutes - travelMinutes(A, to, 'car'))).toBeLessThanOrEqual(1);
    expect((await eta.minutes(A, to, 'tuktuk')).minutes).toBeGreaterThan((await eta.minutes(A, to, 'car')).minutes);
    expect(await eta.minutes(A, A, 'car')).toEqual({ minutes: 1, basis: 'estimated' });
  });
  it('many kitchens to one door in one table call', async () => {
    const osrm = new ScriptedRouter();
    const eta = new EtaService(osrm);
    expect(await eta.fromMany([A], north(1_000), 'bike')).toEqual([{ minutes: 5, basis: 'road' }]);
    expect(await eta.fromMany([], north(1_000), 'bike')).toEqual([]);
    expect(osrm.calls).toBe(1);
  });
  it('OSRM_URL switches road routing on', () => {
    const clock = new FakeClock('2026-10-05T10:00:00Z');
    expect(routerFromEnv(clock, {})).toBeInstanceOf(StraightLineRouter);
    expect(routerFromEnv(clock, { OSRM_URL: 'http://driver-osrm.internal:5000' })).toBeInstanceOf(ResilientRouter);
  });
});
