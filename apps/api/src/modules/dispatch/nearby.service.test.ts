import { describe, expect, it } from 'vitest';
import { NEARBY_RULES, type LatLng, type VehicleClass, type Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { EtaService } from '../routing/index.js';
import type { Router } from '../routing/routing.port.js';
import { haversineKm, offsetPin } from './geo.js';
import { InMemoryGeoIndex } from './geo-index.js';
import { jitterBucket, jitterPin, NearbyService } from './nearby.service.js';
import { headingAfter, HEADING_MIN_MOVE_M, PresenceService } from './presence.service.js';
import { ZoneDirectory } from './zones.js';

const PICKUP: LatLng = { lat: 32.9085, lng: 45.0655 };
const m = (a: LatLng, b: LatLng) => haversineKm(a, b) * 1000;

function setup() {
  const clock = new FakeClock(new Date('2026-10-05T12:00:00Z'));
  const presence = new PresenceService(new InMemoryGeoIndex(() => clock.now()), new ZoneDirectory(new ConfigService()), clock);
  const busy = new Set<string>();
  const tables: LatLng[][] = [];
  // Every source is 60 s per 100 m away (only the shape matters here).
  const router: Router = {
    route: async () => ({ distanceM: 0, durationS: 0, polyline6: null, basis: 'estimated' }),
    table: async (sources, dests) => {
      tables.push([...sources]);
      return { durationsS: sources.map((s) => [m(s, dests[0]!) * 0.6]), distancesM: sources.map((s) => [m(s, dests[0]!)]), basis: 'road' };
    },
  };
  const nearby = new NearbyService(presence, { idle: async (id) => !busy.has(id) }, new EtaService(router), 'test-secret', clock);
  const online = (id: string, at: LatLng, vehicle: VehicleClass, verticals?: Vertical[]) =>
    presence.online(id, { cityId: 'aziziyah', at, vehicle, tier: 'silver', ...(verticals ? { verticals } : {}) });
  return { clock, presence, busy, nearby, online, tables };
}

describe('jitterPin — the blur (maps program c10)', () => {
  it('moves every driver 50–100 m, the same way for the whole 10-minute window, differently in the next', () => {
    const bucket = jitterBucket(Date.parse('2026-10-05T12:00:00Z'));
    for (let i = 0; i < 50; i++) {
      const id = `d${i}`;
      const a = jitterPin(PICKUP, id, bucket, 's');
      expect(m(PICKUP, a)).toBeGreaterThanOrEqual(NEARBY_RULES.jitterMinM - 0.5);
      expect(m(PICKUP, a)).toBeLessThanOrEqual(NEARBY_RULES.jitterMaxM + 0.5);
      expect(jitterPin(PICKUP, id, bucket, 's')).toEqual(a);
    }
    const now = jitterPin(PICKUP, 'd1', bucket, 's');
    expect(jitterPin(PICKUP, 'd1', bucket + 1, 's')).not.toEqual(now);
    // Without the server's secret the offset cannot be worked out.
    expect(jitterPin(PICKUP, 'd1', bucket, 'other')).not.toEqual(now);
    expect(jitterBucket(Date.parse('2026-10-05T12:09:59Z'))).toBe(bucket);
    expect(jitterBucket(Date.parse('2026-10-05T12:10:00Z'))).toBe(bucket + 1);
  });
});

describe('headingAfter — which way a free vehicle is drawn', () => {
  it('from his own movement; GPS noise under 15 m keeps the last heading', () => {
    expect(headingAfter(null, PICKUP)).toBeNull();
    const north = offsetPin(PICKUP, 100, 0);
    expect(headingAfter({ ...PICKUP, heading: null }, north)).toBe(0);
    const east = offsetPin(PICKUP, 100, 90);
    expect(headingAfter({ ...PICKUP, heading: null }, east)).toBe(90);
    expect(headingAfter({ ...PICKUP, heading: 90 }, offsetPin(PICKUP, HEADING_MIN_MOVE_M - 5, 200))).toBe(90);
  });

  it('presence keeps it across heartbeats', async () => {
    const s = setup();
    await s.online('d1', PICKUP, 'car');
    expect((await s.presence.get('d1'))!.heading).toBeNull();
    await s.presence.heartbeat('d1', offsetPin(PICKUP, 200, 180));
    expect((await s.presence.get('d1'))!.heading).toBe(180);
  });
});

describe('NearbyService — free vehicles before booking', () => {
  it('free ones of the asked kind only: vehicle and roles fit, no job; blurred, no ids', async () => {
    const s = setup();
    await s.online('taxi-free', offsetPin(PICKUP, 400, 0), 'car', ['taxi']);
    await s.online('taxi-busy', offsetPin(PICKUP, 300, 90), 'car', ['taxi']);
    await s.online('courier-car', offsetPin(PICKUP, 200, 180), 'car', ['food']);
    await s.online('tuk', offsetPin(PICKUP, 500, 270), 'tuktuk', ['tuktuk']);
    await s.online('far', offsetPin(PICKUP, NEARBY_RULES.radiusM + 500, 45), 'car', ['taxi']);
    s.busy.add('taxi-busy');

    const taxis = await s.nearby.nearby({ cityId: 'aziziyah', pin: PICKUP, vertical: 'taxi' });
    expect(taxis.vehicles).toHaveLength(1);
    const v = taxis.vehicles[0]!;
    expect(Object.keys(v).sort()).toEqual(['heading', 'lat', 'lng']);
    const real = offsetPin(PICKUP, 400, 0);
    expect(m(real, v)).toBeGreaterThanOrEqual(NEARBY_RULES.jitterMinM - 0.5);
    expect(m(real, v)).toBeLessThanOrEqual(NEARBY_RULES.jitterMaxM + 0.5);
    // The minutes come from where he really is (400 m → 240 s → 4 min), not the blurred pin.
    expect(taxis.nearestMinutes).toBe(4);
    expect(s.tables[0]).toEqual([real]);

    // A free car is never a tuktuk (and an SUV is a taxi).
    await s.online('car-any', offsetPin(PICKUP, 250, 135), 'car');
    await s.online('suv', offsetPin(PICKUP, 600, 200), 'suv', ['taxi']);
    expect((await s.nearby.nearby({ cityId: 'aziziyah', pin: PICKUP, vertical: 'taxi' })).vehicles).toHaveLength(3);
    const tuktuks = await s.nearby.nearby({ cityId: 'aziziyah', pin: PICKUP, vertical: 'tuktuk' });
    expect(tuktuks.vehicles).toHaveLength(1);
  });

  it('at most eight, nearest first; none around → empty with no minutes', async () => {
    const s = setup();
    expect(await s.nearby.nearby({ cityId: 'aziziyah', pin: PICKUP, vertical: 'taxi' })).toMatchObject({ vehicles: [], nearestMinutes: null });
    for (let i = 0; i < 12; i++) await s.online(`d${i}`, offsetPin(PICKUP, 200 + i * 150, i * 30), 'car', ['taxi']);
    const r = await s.nearby.nearby({ cityId: 'aziziyah', pin: PICKUP, vertical: 'taxi' });
    expect(r.vehicles).toHaveLength(NEARBY_RULES.max);
    expect(r.nearestMinutes).toBe(2);
  });
});
