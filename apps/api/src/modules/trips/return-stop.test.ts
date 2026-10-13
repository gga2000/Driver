import { describe, expect, it } from 'vitest';
import { DriverError, type LatLng } from '@driver/contracts';
import { PINS, tripsHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const BACK = { zoneKey: 'centre', target: PINS.kitchen };

/** A parcel trip (sender at `kitchen`, receiver at `home`) with the parcel on board and the courier at the door. */
async function atTheDoor(h = tripsHarness(), vertical: 'parcel' | 'food' | 'khat' | 'intercity' = 'parcel') {
  const t = await h.acceptedTrip('ord_p', 'd1', { vertical });
  const [pickup, door] = t.stops;
  await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen });
  await h.trips.completeStop(t.id, pickup!.id, 'd1');
  await h.trips.arrive(t.id, door!.id, 'd1', { pin: PINS.home });
  return { h, t, pickup: pickup!, door: door! };
}

describe('trips.returnStop (a refused parcel goes back to the sender)', () => {
  it('adds the hand-back stop, then skips the door: the trip stays in progress, not completed', async () => {
    const { h, t, door } = await atTheDoor();
    const after = await h.trips.returnStop(t.id, 'ord_p', 'd1', BACK);
    expect(after.state).toBe('in_transit');
    expect(after.completedAt).toBeNull();
    const skipped = after.stops.find((s) => s.id === door.id)!;
    expect(skipped).toMatchObject({ state: 'skipped', skipReason: 'parcel_refused' });
    const back = after.stops.find((s) => s.seq > door.seq)!;
    expect(back).toMatchObject({ orderId: 'ord_p', type: 'dropoff', state: 'pending', zoneKey: 'centre', target: PINS.kitchen });
    expect(back.seq).toBe(Math.max(...t.stops.map((s) => s.seq)) + 1);
    expect(h.events.ofType('trip.completed')).toHaveLength(0);
    expect(h.events.ofType('stop.skipped').map((e) => e.payload)).toEqual([{ stopId: door.id, stopType: 'dropoff', reason: 'parcel_refused' }]);
    expect(h.events.ofType('trip.parcel_returning').map((e) => e.payload)).toEqual([{ orderId: 'ord_p', stopId: back.id, skippedStopId: door.id }]);
  });

  it('a replay returns the trip as it stands and emits nothing more', async () => {
    const { h, t } = await atTheDoor();
    const first = await h.trips.returnStop(t.id, 'ord_p', 'd1', BACK);
    const count = h.events.types().length;
    const again = await h.trips.returnStop(t.id, 'ord_p', 'd1', BACK);
    expect(again.stops).toEqual(first.stops);
    expect(h.events.types()).toHaveLength(count);
  });

  it('the hand-back completes through completeStop with no code: the guard is asked with the stop id and target', async () => {
    const { h, t, door } = await atTheDoor();
    const asked: Array<{ orderId: string; stopId: string; target: LatLng | null }> = [];
    // As parcels binds it: the receiver's door needs the code; another drop-off target (the hand-back) does not.
    h.trips.bindDropoffGuard({
      check: async (orderId, stop) => {
        asked.push({ orderId, ...stop });
        return stop.target && stop.target.lat === PINS.home.lat ? 'parcel_pin_not_verified' : null;
      },
    });
    const after = await h.trips.returnStop(t.id, 'ord_p', 'd1', BACK);
    const back = after.stops.find((s) => s.seq > door.seq)!;
    // The skipped door stop can never be completed afterwards.
    expect(await code(h.trips.completeStop(t.id, door.id, 'd1'))).toBe('stop_state_conflict');
    await h.trips.arrive(t.id, back.id, 'd1', { pin: PINS.kitchen });
    const done = await h.trips.completeStop(t.id, back.id, 'd1', { handover: { cashCollectedIqd: 6000 } });
    expect(done.state).toBe('completed');
    expect(asked).toEqual([{ orderId: 'ord_p', stopId: back.id, target: PINS.kitchen }]);
    expect(h.events.ofType('stop.completed').at(-1)?.payload).toMatchObject({ stopId: back.id, stopType: 'dropoff', cashCollectedIqd: 6000 });
  });

  it('the guard still stops the door stop without the code (before any refusal)', async () => {
    const { h, t, door } = await atTheDoor();
    h.trips.bindDropoffGuard({ check: async (_o, stop) => (stop.target?.lat === PINS.home.lat ? 'parcel_pin_not_verified' : null) });
    expect(await code(h.trips.completeStop(t.id, door.id, 'd1'))).toBe('parcel_pin_not_verified');
  });

  it('refuses another courier, a finished trip, a parcel not on board, and khat or intercity trips', async () => {
    const { h, t } = await atTheDoor();
    expect(await code(h.trips.returnStop(t.id, 'ord_p', 'd2', BACK))).toBe('not_trip_courier');
    expect(await code(h.trips.returnStop(t.id, 'ord_other', 'd1', BACK))).toBe('stop_not_found');

    const done = await atTheDoor(tripsHarness());
    await done.h.trips.completeStop(done.t.id, done.door.id, 'd1');
    expect(await code(done.h.trips.returnStop(done.t.id, 'ord_p', 'd1', BACK))).toBe('trip_state_conflict');

    const early = tripsHarness();
    const e = await early.acceptedTrip('ord_p', 'd1', { vertical: 'parcel' });
    expect(await code(early.trips.returnStop(e.id, 'ord_p', 'd1', BACK))).toBe('stop_state_conflict');

    for (const vertical of ['khat', 'intercity'] as const) {
      const x = tripsHarness();
      const trip = await x.acceptedTrip('ord_p', 'd1', { vertical });
      expect(await code(x.trips.returnStop(trip.id, 'ord_p', 'd1', BACK))).toBe('order_type_not_supported');
    }
  });

  it('a cancelled trip is refused', async () => {
    const { h, t } = await atTheDoor();
    await h.trips.cancel(t.id, 'platform', 'ops_1', 'test');
    expect(await code(h.trips.returnStop(t.id, 'ord_p', 'd1', BACK))).toBe('trip_state_conflict');
  });
});
