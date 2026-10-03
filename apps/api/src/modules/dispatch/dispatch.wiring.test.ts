import { describe, expect, it } from 'vitest';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;

const food = (h: H, tripId: string, extra: Record<string, unknown> = {}) =>
  h.service.request({ tripId, cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true, ...extra });

const taxi = (h: H, tripId: string) => h.service.request({ tripId, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });

async function respond(h: H, tripId: string, driverId: string, accept = true) {
  const offer = await h.openOffer(tripId, driverId);
  if (!offer) throw new Error(`no open offer for ${driverId} on ${tripId}`);
  return h.service.respond(h.actor(driverId), { offerId: offer.id, accept });
}

/** M2 wiring: dispatch against the real ports' contracts (caps by exposure, vehicle class, offer outcomes to trips). */
describe('dispatch ↔ trips / ledger ports', () => {
  it('a cash job is offered only to couriers whose cap has room for it (CapsPort.canOffer)', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'bike' });
    await h.online('k2', 0.6, { vehicle: 'bike' });
    h.caps.remaining.set('k1', 10_000);
    await food(h, 'f1', { cashIqd: 16_500 });
    expect(h.trips.offeredTo('f1')).toEqual(['k2']);
    expect(h.caps.asked.find((a) => a.driverId === 'k2')).toEqual({ driverId: 'k2', job: { valueIqd: 16_500, prepaid: false } });
    await food(h, 'f2'); // prepaid: no cash exposure, the nearest courier gets it
    expect(h.trips.offeredTo('f2')).toEqual(['k1']);
  });

  it('the order’s vehicle requirement filters couriers (a bike never gets a tuktuk-sized order)', async () => {
    const h = dispatchHarness();
    await h.online('bike', 0.2, { vehicle: 'bike' });
    await h.online('tuk', 0.6, { vehicle: 'tuktuk' });
    await food(h, 'f1', { minVehicleClass: 'tuktuk' });
    expect(h.trips.offeredTo('f1')).toEqual(['tuk']);
  });

  it('declines and timeouts are reported to trips; othersPending while the wave is still open', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'bike' });
    await h.online('k2', 0.4, { vehicle: 'bike' });
    await food(h, 'f1');
    await respond(h, 'f1', 'k1', false);
    expect(h.trips.outcomes).toEqual([{ kind: 'decline', tripId: 'f1', driverId: 'k1', othersPending: false }]);
    await h.advance(20);
    expect(h.trips.outcomes.at(-1)).toEqual({ kind: 'timeout', tripId: 'f1', driverId: 'k2', othersPending: false });

    for (const [id, km] of [['a1', 0.2], ['a2', 0.5], ['a3', 1.0]] as const) await h.online(id, km, { vehicle: 'car' });
    await taxi(h, 't9');
    await respond(h, 't9', 'a1', false);
    expect(h.trips.outcomes.at(-1)).toEqual({ kind: 'decline', tripId: 't9', driverId: 'a1', othersPending: true });
  });

  it('the assignment carries the courier’s vehicle class (trips checks the order cap against it)', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'tuktuk' });
    await food(h, 'f1');
    await respond(h, 'f1', 'k1');
    expect(h.trips.vehicles).toEqual([{ tripId: 'f1', driverId: 'k1', vehicleClass: 'tuktuk' }]);
  });

  it('a failed assignment in trips releases the first-accept lock', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'bike' });
    await food(h, 'f1');
    h.trips.failAssign = new Error('vehicle_too_small');
    await expect(respond(h, 'f1', 'k1')).rejects.toThrow('vehicle_too_small');
    expect(await h.store.tryLock('dispatch:lock:f1', 'probe', 1000)).toBe(true);
  });

  it('trip.accepted from the Partner app (trips.accept) assigns the request without a second assign', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'bike' });
    await food(h, 'f1');
    await h.orchestrator.onTripAccepted('f1', 'k1');
    expect(await h.service.getRequest('f1')).toMatchObject({ status: 'assigned', assignedDriverId: 'k1' });
    expect((await h.offers('f1')).map((o) => o.state)).toEqual(['accepted']);
    expect(h.trips.assigns).toEqual([]);
    expect(h.events.last('dispatch.assigned')?.payload).toMatchObject({ driverId: 'k1', via: 'trip' });
    // a replay, or the echo of an assignment dispatch made itself, is a no-op
    await h.orchestrator.onTripAccepted('f1', 'k1');
    expect(h.events.ofType('dispatch.assigned')).toHaveLength(1);
  });

  it('trip.declined from the Partner app moves auto-assign to the next courier without echoing back to trips', async () => {
    const h = dispatchHarness();
    await h.online('k1', 0.2, { vehicle: 'bike' });
    await h.online('k2', 0.4, { vehicle: 'bike' });
    await food(h, 'f1');
    await h.orchestrator.onTripDeclined('f1', 'k1');
    expect(h.trips.offeredTo('f1')).toEqual(['k1', 'k2']);
    expect(h.trips.outcomes).toEqual([]);
    await h.orchestrator.onTripDeclined('f1', 'k1'); // replay
    expect(h.trips.offeredTo('f1')).toEqual(['k1', 'k2']);
  });
});
