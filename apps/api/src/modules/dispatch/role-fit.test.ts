import { describe, expect, it } from 'vitest';
import { dispatchHarness, north } from './test-harness.js';
import { servedVerticals } from './vehicles.js';

type H = ReturnType<typeof dispatchHarness>;

const ride = (h: H, tripId: string, vertical: 'taxi' | 'tuktuk') => h.service.request({ tripId, cityId: 'aziziyah', vertical, zoneId: 'centre', pickup: north(0) });
const delivery = (h: H, tripId: string, vertical: 'food' | 'parcel' = 'food') =>
  h.service.request({ tripId, cityId: 'aziziyah', vertical, zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true });

describe('roles × vehicles → verticals (backend review 2026-10-04 #20)', () => {
  it('a courier delivers (food, grocery, errand, parcel) on what he rides; a driver drives rides of his vehicle', () => {
    expect(servedVerticals(['courier'], 'bike')).toEqual(['food', 'grocery', 'errand', 'parcel']);
    expect(servedVerticals(['courier'], 'car')).toEqual(['food', 'grocery', 'errand', 'parcel']);
    expect(servedVerticals(['driver'], 'car')).toEqual(['taxi']);
    expect(servedVerticals(['driver'], 'tuktuk')).toEqual(['tuktuk']);
    expect(servedVerticals(['driver'], 'bike')).toEqual([]);
    expect(servedVerticals(['driver', 'courier'], 'tuktuk')).toEqual(['food', 'grocery', 'errand', 'parcel', 'tuktuk']);
    // خطوط and الرجعة are their own roles: a taxi driver is never a school-run or intercity driver by default.
    expect(servedVerticals(['driver'], 'van')).toEqual([]);
    expect(servedVerticals(['khat_driver'], 'van')).toEqual(['khat']);
    expect(servedVerticals(['intercity_driver'], 'car')).toEqual(['intercity']);
    expect(servedVerticals(['customer', 'merchant_owner'], 'car')).toEqual([]);
  });
});

describe('dispatch candidate selection checks role and vehicle (review #20)', () => {
  it('a courier who went online in a car is never offered taxi rides', async () => {
    const h = dispatchHarness();
    await h.online('courier_car', 0.2, { vehicle: 'car', verticals: servedVerticals(['courier'], 'car') });
    await h.online('taxi_driver', 1.0, { vehicle: 'car', verticals: servedVerticals(['driver'], 'car') });
    await ride(h, 't1', 'taxi');
    expect(h.trips.offers[0]?.driverIds).toEqual(['taxi_driver']);
  });

  it('a taxi driver is never offered a food delivery; a courier is', async () => {
    const h = dispatchHarness();
    await h.online('taxi_driver', 0.1, { vehicle: 'car', verticals: servedVerticals(['driver'], 'car') });
    await h.online('courier_bike', 1.0, { vehicle: 'bike', verticals: servedVerticals(['courier'], 'bike') });
    await delivery(h, 'f1');
    await h.advance(1);
    const offered = (await h.offers('f1')).map((o) => o.driverId);
    expect(offered).toContain('courier_bike');
    expect(offered).not.toContain('taxi_driver');
  });

  it('a tuktuk driver gets tuktuk rides, not taxi rides', async () => {
    const h = dispatchHarness();
    await h.online('tuk', 0.1, { vehicle: 'tuktuk', verticals: servedVerticals(['driver'], 'tuktuk') });
    await ride(h, 't1', 'taxi');
    expect(h.trips.offers).toHaveLength(0);
    await ride(h, 't2', 'tuktuk');
    expect(h.trips.offers[0]?.driverIds).toEqual(['tuk']);
  });

  it('the declared vehicle is kept in presence with what he may serve (survives heartbeats)', async () => {
    const h = dispatchHarness();
    await h.online('c1', 0.3, { vehicle: 'bike', verticals: servedVerticals(['courier'], 'bike') });
    await h.heartbeatAll(['c1']);
    expect((await h.presence.get('c1'))?.verticals).toEqual(['food', 'grocery', 'errand', 'parcel']);
  });
});
