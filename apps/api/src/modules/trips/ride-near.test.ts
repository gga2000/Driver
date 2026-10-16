import { describe, expect, it } from 'vitest';
import { RIDE_NEAR_RULES } from '@driver/contracts';
import { PINS, tripsHarness } from './test-harness.js';

/**
 * d3 «السايق قريب، اطلع هسة» (ride step 3): once per ride, the first fix the one ETA puts within a
 * minute of the pickup stamps the pickup and emits `stop.driver_near`.
 */
function harness(eta: (pinLat: number) => number | null) {
  const h = tripsHarness();
  const asked: number[] = [];
  h.trips.bindRideNear({
    secondsToPickup: async (_trip, _orderId, pin) => {
      asked.push(pin.lat);
      return eta(pin.lat);
    },
  });
  return { ...h, asked };
}

const at = (h: ReturnType<typeof harness>) => h.clock.now();

describe('ride near (d3)', () => {
  it('fires once, when the ETA reaches a minute, on taxi and tuktuk rides', async () => {
    for (const vertical of ['taxi', 'tuktuk'] as const) {
      const h = harness((lat) => (lat === PINS.kitchen.lat + 0.002 ? 90 : 55));
      const t = await h.acceptedTrip('ord_1', 'd1', { vertical, vehicleClass: vertical === 'taxi' ? 'car' : 'tuktuk' });
      await h.trips.reportPosition('d1', { tripId: t.id, pin: { lat: PINS.kitchen.lat + 0.002, lng: PINS.kitchen.lng }, at: at(h) });
      expect(h.events.events.some((e) => e.type === 'stop.driver_near')).toBe(false);
      await h.trips.reportPosition('d1', { tripId: t.id, pin: { lat: PINS.kitchen.lat + 0.001, lng: PINS.kitchen.lng }, at: at(h) });
      await h.trips.reportPosition('d1', { tripId: t.id, pin: { lat: PINS.kitchen.lat + 0.0005, lng: PINS.kitchen.lng }, at: at(h) });
      const near = h.events.events.filter((e) => e.type === 'stop.driver_near');
      const pickup = (await h.trips.get(t.id)).stops.find((s) => s.type === 'pickup')!;
      expect(near).toHaveLength(1);
      expect(near[0]!.payload).toEqual({ stopId: pickup.id, etaSec: 55 });
      expect(near[0]!.orderId).toBe('ord_1');
      expect(pickup.courierNearAt).not.toBeNull();
      // Stamped: the ETA is not asked again.
      expect(h.asked).toHaveLength(2);
    }
  });

  it(`does not ask for an ETA beyond ${RIDE_NEAR_RULES.checkWithinM} m, nor for food`, async () => {
    const h = harness(() => 10);
    const ride = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    await h.trips.reportPosition('d1', { tripId: ride.id, pin: { lat: PINS.kitchen.lat + 0.03, lng: PINS.kitchen.lng }, at: at(h) });
    expect(h.asked).toEqual([]);
    const food = await h.acceptedTrip('ord_2', 'd2');
    await h.trips.reportPosition('d2', { tripId: food.id, pin: PINS.kitchen, at: at(h) });
    expect(h.asked).toEqual([]);
    expect(h.events.events.some((e) => e.type === 'stop.driver_near')).toBe(false);
  });

  it('an unknown ETA or a routing failure only skips that fix', async () => {
    let calls = 0;
    const h = tripsHarness();
    h.trips.bindRideNear({
      secondsToPickup: async () => {
        calls += 1;
        if (calls === 1) throw new Error('router down');
        if (calls === 2) return null;
        return 30;
      },
    });
    const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    const pin = { lat: PINS.kitchen.lat + 0.001, lng: PINS.kitchen.lng };
    await h.trips.reportPosition('d1', { tripId: t.id, pin, at: h.clock.now() });
    await h.trips.reportPosition('d1', { tripId: t.id, pin, at: h.clock.now() });
    expect(h.events.events.some((e) => e.type === 'stop.driver_near')).toBe(false);
    await h.trips.reportPosition('d1', { tripId: t.id, pin, at: h.clock.now() });
    expect(h.events.events.filter((e) => e.type === 'stop.driver_near')).toHaveLength(1);
  });

  it('asks the router after the position commits, never while a transaction is open (perf item 14)', async () => {
    const h = tripsHarness();
    const seen: Array<{ inTx: boolean; logAtAsk: string[]; trail: number }> = [];
    h.trips.bindRideNear({
      secondsToPickup: async () => {
        seen.push({ inTx: h.uow.current() !== undefined, logAtAsk: [...h.log], trail: (await h.trips.trailOf(t.id)).length });
        return 30;
      },
    });
    const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    const pin = { lat: PINS.kitchen.lat + 0.001, lng: PINS.kitchen.lng };
    const before = h.log.length;
    await h.trips.reportPosition('d1', { tripId: t.id, pin, at: h.clock.now() });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.inTx).toBe(false);
    // The fix's own transaction had committed (and its trail point was stored) before the router was asked.
    expect(seen[0]!.logAtAsk.slice(before)).toEqual([`commit ${before + 1}`]);
    expect(seen[0]!.trail).toBe(1);
    // The stamp then commits in its own short transaction, once.
    expect(h.log.slice(before)).toEqual([`commit ${before + 1}`, `commit ${before + 2}`]);
    expect(h.events.events.filter((e) => e.type === 'stop.driver_near')).toHaveLength(1);
  });

  it('a pickup reached while the router was answering is not stamped late', async () => {
    const h = tripsHarness();
    h.trips.bindRideNear({
      secondsToPickup: async () => {
        // The driver taps «وصلت» between the fix's commit and the ETA's answer.
        await h.trips.arrive(t.id, t.stops.find((s) => s.type === 'pickup')!.id, 'd1', { pin: PINS.kitchen });
        return 10;
      },
    });
    const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    await h.trips.reportPosition('d1', { tripId: t.id, pin: { lat: PINS.kitchen.lat + 0.001, lng: PINS.kitchen.lng }, at: h.clock.now() });
    expect(h.events.events.some((e) => e.type === 'stop.driver_near')).toBe(false);
  });

  it('nothing once the rider is picked up', async () => {
    const h = harness(() => 10);
    const t = await h.acceptedTrip('ord_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    const pickup = t.stops.find((s) => s.type === 'pickup')!;
    await h.trips.arrive(t.id, pickup.id, 'd1', { pin: PINS.kitchen });
    await h.trips.reportPosition('d1', { tripId: t.id, pin: PINS.kitchen, at: at(h) });
    expect(h.asked).toEqual([]);
  });
});
