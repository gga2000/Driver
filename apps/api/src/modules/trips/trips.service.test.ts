import { describe, expect, it } from 'vitest';
import { pickupCodeFor } from '../../shared/pickup-code.js';
import { DriverError } from '@driver/contracts';
import { offsetNorth } from './geofence.js';
import { TripsRpc } from './trips.rpc.js';
import { PINS, tripsHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

describe('TripsService — offer loop', () => {
  it('created → offered → accepted → en route, with events', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip();
    expect(t.state).toBe('created');
    expect(t.orders).toHaveLength(1);
    await h.trips.offer(t.id, { driverIds: ['d1', 'd2', 'd3'] });
    const accepted = await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    expect(accepted.state).toBe('en_route_to_pickup');
    expect(accepted.courierId).toBe('d1');
    expect(h.events.types()).toEqual(['trip.created', 'trip.offered', 'trip.accepted', 'trip.en_route']);
  });

  it('decline with other offers open keeps it offered; the last decline moves to declined; re-offer returns', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip();
    await h.trips.offer(t.id, { driverIds: ['d1', 'd2'] });
    expect((await h.trips.decline(t.id, 'd1', { othersPending: true })).state).toBe('offered');
    expect((await h.trips.decline(t.id, 'd2')).state).toBe('declined');
    expect((await h.trips.offer(t.id, { driverIds: ['d3'], wave: 2 })).state).toBe('offered');
    expect((await h.trips.timeout(t.id, { driverId: 'd3' })).state).toBe('timed_out');
    expect(await code(h.trips.accept(t.id, 'd3', { vehicleClass: 'bike' }))).toBe('trip_state_conflict');
    expect(h.events.ofType('trip.declined')).toHaveLength(2);
  });

  it('first accept wins; a second driver gets a conflict', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip();
    await h.trips.offer(t.id);
    const [a, b] = await Promise.all([code(h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' })), code(h.trips.accept(t.id, 'd2', { vehicleClass: 'bike' }))]);
    expect([a, b].sort()).toEqual(['ok', 'trip_state_conflict']);
  });

  it('review H: a driver on a job cannot accept a second trip directly; only dispatch may batch', async () => {
    const h = tripsHarness();
    const first = await h.acceptedTrip('ord_1', 'd1');
    const second = await h.foodTrip('ord_2');
    await h.trips.offer(second.id);
    expect(await code(h.trips.accept(second.id, 'd1', { vehicleClass: 'bike' }))).toBe('offer_conflicts_current_job');
    expect((await h.trips.get(second.id)).state).toBe('offered');
    // Replaying the accept of the trip he holds stays a no-op.
    expect((await h.trips.accept(first.id, 'd1', { vehicleClass: 'bike' })).courierId).toBe('d1');
    // Dispatch, having applied its batching rules, may still hand him the second one.
    expect((await h.trips.accept(second.id, 'd1', { vehicleClass: 'bike' }, { assignedByDispatch: true })).courierId).toBe('d1');
    // Once his jobs are done he is free again.
    const third = await h.foodTrip('ord_3');
    await h.trips.offer(third.id);
    await h.trips.cancel(first.id, 'platform', 'ops', 'test');
    await h.trips.cancel(second.id, 'platform', 'ops', 'test');
    expect((await h.trips.accept(third.id, 'd1', { vehicleClass: 'bike' })).courierId).toBe('d1');
  });

  it('order caps per vehicle class: a bike cannot take a car-sized order (edge-case A.16)', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip('ord_big', { minVehicleClass: 'car' });
    await h.trips.offer(t.id);
    expect(await code(h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' }))).toBe('vehicle_too_small');
    expect(await code(h.trips.accept(t.id, 'd1', { vehicleClass: 'tuktuk' }))).toBe('vehicle_too_small');
    expect((await h.trips.accept(t.id, 'd2', { vehicleClass: 'car' })).courierId).toBe('d2');
  });
});

describe('TripsService — stops, geofence and arrival', () => {
  it('geofence arms the button at 50 m but not at 70 m and records the first entry', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const pickup = t.stops[0]!;
    const far = await h.trips.reportPosition('d1', { tripId: t.id, pin: offsetNorth(PINS.kitchen, 70), at: h.clock.now() });
    expect(far.armed).toEqual([]);
    h.clock.advanceSeconds(10);
    const near = await h.trips.reportPosition('d1', { pin: offsetNorth(PINS.kitchen, 50), at: h.clock.now() });
    expect(near.armed).toEqual([{ tripId: t.id, stopId: pickup.id, distanceM: 50 }]);
    expect((await h.trips.get(t.id)).stops[0]!.geofenceEnteredAt).toEqual(h.clock.now());
    await h.trips.reportPosition('d1', { pin: offsetNorth(PINS.kitchen, 40), at: h.clock.now() });
    expect(h.events.ofType('stop.geofence_entered')).toHaveLength(1);
    expect(h.repo.trail).toHaveLength(3);
  });

  it('arrival outside the geofence is recorded and flagged, never blocked', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const pickup = t.stops[0]!;
    const after = await h.trips.arrive(t.id, pickup.id, 'd1', { pin: offsetNorth(PINS.kitchen, 140) });
    expect(after.state).toBe('arrived_pickup');
    expect(after.stops[0]).toMatchObject({ state: 'arrived', arrivedOutsideGeofence: true, arrivalDistanceM: 140 });
    expect(h.events.last('stop.arrived')!.payload).toMatchObject({ outsideGeofence: true, flagged: true, distanceM: 140 });
  });

  it('arrival time is server receipt time; the device time stays on the event (edge-case §10)', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const device = new Date(h.clock.now().getTime() - 4 * 60_000);
    const after = await h.trips.arrive(t.id, t.stops[0]!.id, 'd1', { pin: PINS.kitchen, occurredAt: device, deviceUptimeMs: 123_456 });
    expect(after.stops[0]!.arrivedAt).toEqual(h.clock.now());
    const ev = h.events.last('stop.arrived')!;
    expect(ev.occurredAt).toEqual(device);
    expect(ev.deviceUptimeMs).toBe(123_456);
    expect(ev.orderId).toBe('ord_1');
  });

  it('no stop completes before it was arrived; only the courier may tap', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    expect(await code(h.trips.completeStop(t.id, t.stops[0]!.id, 'd1'))).toBe('stop_state_conflict');
    expect(await code(h.trips.arrive(t.id, t.stops[0]!.id, 'd2'))).toBe('not_trip_courier');
  });

  it('full delivery: state derives from stops and the trip completes on the last hand-over', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const [pickup, dropoff] = t.stops;
    await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen });
    const collected = await h.trips.completeStop(t.id, pickup!.id, 'd1', { handover: { pickupCode: '0000' } });
    expect(collected.state).toBe('in_transit');
    // Maps program r4: the server writes the code the kitchen read (what the client sends is replaced).
    expect(collected.stops[0]!.handoverProof).toMatchObject({ pickupCode: pickupCodeFor(pickup!.orderId!, 'd1') });
    expect((await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home })).state).toBe('arrived_dropoff');
    const done = await h.trips.completeStop(t.id, dropoff!.id, 'd1', { handover: { cashCollectedIqd: 16500, photoUrl: 'https://cdn.example/p.jpg' } });
    expect(done.state).toBe('completed');
    expect(done.completedAt).toEqual(h.clock.now());
    expect(h.events.last('stop.completed')!.payload).toMatchObject({ stopType: 'dropoff', cashCollectedIqd: 16500, photo: true });
    expect(h.events.last('trip.completed')!.payload).toMatchObject({ by: 'driver', orderIds: ['ord_1'] });
  });

  it('maps a3: a delivered drop-off at a saved place carries the arrival fix and its accuracy as the door', async () => {
    const h = tripsHarness();
    const t = await h.trips.createForOrders({ cityId: 'aziziyah', vertical: 'food', orders: [{ orderId: 'ord_1', minVehicleClass: null }], stops: [{ orderId: 'ord_1', type: 'pickup', zoneKey: 'centre', target: PINS.kitchen }, { orderId: 'ord_1', type: 'dropoff', zoneKey: 'zakur', target: PINS.home, placeId: 'pl_home' }] });
    await h.trips.offer(t.id, { driverIds: ['d1'] });
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    const [pickup, dropoff] = t.stops;
    await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen, accuracyM: 50 });
    await h.trips.completeStop(t.id, pickup!.id, 'd1');
    // The pickup carries no door: only drop-offs at saved places teach one.
    expect(h.events.last('stop.completed')!.payload).not.toHaveProperty('door');
    await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home, accuracyM: 9 });
    await h.trips.completeStop(t.id, dropoff!.id, 'd1', { handover: { cashCollectedIqd: 16500 } });
    expect(h.events.last('stop.completed')!.payload).toMatchObject({ stopType: 'dropoff', door: { placeId: 'pl_home', courierId: 'd1', lat: PINS.home.lat, lng: PINS.home.lng, accuracyM: 9 } });
  });

  it('maps a3: a tap from the street corner (outside the geofence) or without its own fix teaches no door', async () => {
    const h = tripsHarness();
    const run = async (orderId: string, arrival: { pin?: { lat: number; lng: number }; accuracyM?: number }) => {
      const t = await h.trips.createForOrders({ cityId: 'aziziyah', vertical: 'food', orders: [{ orderId, minVehicleClass: null }], stops: [{ orderId, type: 'pickup', zoneKey: 'centre', target: PINS.kitchen }, { orderId, type: 'dropoff', zoneKey: 'zakur', target: PINS.home, placeId: 'pl_home' }] });
      await h.trips.offer(t.id, { driverIds: ['d1'] });
      await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
      const [pickup, dropoff] = t.stops;
      await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen });
      await h.trips.completeStop(t.id, pickup!.id, 'd1');
      await h.trips.arrive(t.id, dropoff!.id, 'd1', arrival);
      await h.trips.completeStop(t.id, dropoff!.id, 'd1', { handover: { cashCollectedIqd: 16500 } });
      return h.events.last('stop.completed')!.payload;
    };
    expect(await run('ord_far', { pin: h.near(PINS.home, 120), accuracyM: 5 })).not.toHaveProperty('door');
    expect(await run('ord_nofix', {})).not.toHaveProperty('door');
  });

  it('maps SP3: only the drop-off that ends the trip carries the arrival fix for the zone question', async () => {
    const h = tripsHarness();
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'food',
      orders: [{ orderId: 'ord_1', minVehicleClass: null }, { orderId: 'ord_2', minVehicleClass: null }],
      stops: [
        { orderId: 'ord_1', type: 'pickup', zoneKey: 'centre', target: PINS.kitchen },
        { orderId: 'ord_2', type: 'pickup', zoneKey: 'centre', target: PINS.kitchen },
        { orderId: 'ord_1', type: 'dropoff', zoneKey: 'zakur', target: PINS.home },
        { orderId: 'ord_2', type: 'dropoff', zoneKey: 'zakur', target: PINS.home },
      ],
    });
    await h.trips.offer(t.id, { driverIds: ['d1'] });
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    const [p1, p2, d1, d2] = t.stops;
    for (const s of [p1!, p2!]) {
      await h.trips.arrive(t.id, s.id, 'd1', { pin: PINS.kitchen, accuracyM: 12 });
      await h.trips.completeStop(t.id, s.id, 'd1');
      expect(h.events.last('stop.completed')!.payload).not.toHaveProperty('finalDrop');
    }
    await h.trips.arrive(t.id, d1!.id, 'd1', { pin: PINS.home, accuracyM: 7 });
    await h.trips.completeStop(t.id, d1!.id, 'd1');
    expect(h.events.last('stop.completed')!.payload).not.toHaveProperty('finalDrop');
    await h.trips.arrive(t.id, d2!.id, 'd1', { pin: PINS.home, accuracyM: 7 });
    await h.trips.completeStop(t.id, d2!.id, 'd1');
    expect(h.events.last('stop.completed')!.payload).toMatchObject({ finalDrop: { cityId: 'aziziyah', lat: PINS.home.lat, lng: PINS.home.lng, accuracyM: 7 } });
  });

  it('idempotent replay: repeated accept / arrive / complete change nothing and emit nothing', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const before = h.events.events.length;
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    expect(h.events.events.length).toBe(before);
    const stop = t.stops[0]!.id;
    await h.trips.arrive(t.id, stop, 'd1', { pin: PINS.kitchen, idempotencyKey: 'arr-0001' });
    const a = await h.trips.arrive(t.id, stop, 'd1', { pin: PINS.kitchen, idempotencyKey: 'arr-0001' });
    await h.trips.completeStop(t.id, stop, 'd1', { idempotencyKey: 'cmp-0001' });
    const b = await h.trips.completeStop(t.id, stop, 'd1', { idempotencyKey: 'cmp-0001' });
    expect(a.stops[0]!.state).toBe('arrived');
    expect(b.stops[0]!.state).toBe('completed');
    expect(h.events.ofType('stop.arrived')).toHaveLength(1);
    expect(h.events.ofType('stop.completed')).toHaveLength(1);
    expect(h.events.last('stop.arrived')!.idempotencyKey).toBe(`stop.arrived:d1:trip:${t.id}/stop:${stop}:arr-0001`);
  });

  it('review H: a client key reused on another trip or stop never swallows that other action', async () => {
    const h = tripsHarness();
    const done: string[] = [];
    for (const order of ['ord_1', 'ord_2']) {
      const t = await h.acceptedTrip(order, 'd1');
      const [pickup, dropoff] = t.stops;
      // A buggy (or restarted) key generator hands out the same keys for every job.
      await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen, idempotencyKey: 'k-arrive' });
      await h.trips.completeStop(t.id, pickup!.id, 'd1', { idempotencyKey: 'k-complete' });
      await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home, idempotencyKey: 'k-arrive' });
      await h.trips.completeStop(t.id, dropoff!.id, 'd1', { idempotencyKey: 'k-complete' });
      // The real replay of the same tap is still a no-op.
      await h.trips.completeStop(t.id, dropoff!.id, 'd1', { idempotencyKey: 'k-complete' });
      expect((await h.trips.get(t.id)).state).toBe('completed');
      done.push(t.id);
    }
    for (const tripId of done) {
      expect(h.events.ofType('stop.arrived').filter((e) => e.tripId === tripId)).toHaveLength(2);
      expect(h.events.ofType('stop.completed').filter((e) => e.tripId === tripId)).toHaveLength(2);
    }
  });

  it('khat: a child on a stop cannot be handed over without the tap; tap-out at school notifies the guardian', async () => {
    const h = tripsHarness();
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'khat',
      orders: [{ orderId: 'sub_1' }],
      stops: [
        { orderId: 'sub_1', type: 'pickup', zoneKey: 'zakur', target: PINS.home, childRef: 'chref_zainab' },
        { orderId: 'sub_1', type: 'dropoff', zoneKey: 'centre', target: PINS.school, childRef: 'chref_zainab' },
      ],
    });
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'k1', { vehicleClass: 'car' });
    const [home, school] = t.stops;
    await h.trips.arrive(t.id, home!.id, 'k1', { pin: PINS.home });
    expect(await code(h.trips.completeStop(t.id, home!.id, 'k1'))).toBe('child_handover_required');
    await h.trips.completeStop(t.id, home!.id, 'k1', { handover: { childTap: 'in' } });
    await h.trips.arrive(t.id, school!.id, 'k1', { pin: PINS.school });
    const done = await h.trips.completeStop(t.id, school!.id, 'k1', { handover: { childTap: 'out' } });
    expect(done.stops[1]!.childTapOutAt).toEqual(h.clock.now());
    expect(h.events.last('khat.child_tapped_out')!.payload).toMatchObject({ childRef: 'chref_zainab', notifyGuardian: true });
    expect(h.events.last('khat.child_tapped_in')!.payload).toMatchObject({ childRef: 'chref_zainab', notifyGuardian: false });
  });

  it('M2 follow-up: stops and khat events carry only the opaque childRef; the run sheet resolves names through identity', async () => {
    const h = tripsHarness();
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'khat',
      orders: [{ orderId: 'sub_1' }],
      stops: [
        { orderId: 'sub_1', type: 'pickup', zoneKey: 'zakur', target: PINS.home, childRef: 'chref_zainab' },
        { orderId: 'sub_1', type: 'dropoff', zoneKey: 'centre', target: PINS.school, childRef: 'chref_zainab' },
      ],
    });
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'k1', { vehicleClass: 'car' });
    const [home] = t.stops;
    await h.trips.arrive(t.id, home!.id, 'k1', { pin: PINS.home });
    await h.trips.completeStop(t.id, home!.id, 'k1', { handover: { childTap: 'in' } });
    // Nothing trips stores or emits holds a name.
    const view = await h.trips.get(t.id);
    expect(view.stops.map((s) => s.childRef)).toEqual(['chref_zainab', 'chref_zainab']);
    expect(view.stops[0]).not.toHaveProperty('childName');
    expect(h.events.last('khat.child_tapped_in')!.payload).not.toHaveProperty('childName');
    expect([...h.repo.stops.values()].every((s) => !('childName' in s))).toBe(true);

    // The run sheet: names come from identity's port, asked as the trip's driver; nobody else gets one.
    const asked: Array<{ driverId: string; refs: readonly string[] }> = [];
    const names = { childNamesForRunSheet: async (driverId: string, refs: readonly string[]) => (asked.push({ driverId, refs }), { chref_zainab: 'زينب' }) };
    const rpc = new TripsRpc(h.trips, { hasRole: async () => false }, names);
    const sheet = await rpc.runSheet({ personId: 'k1', sessionId: 's' }, { tripId: t.id });
    expect(sheet.stops.map((s) => [s.type, s.childRef, s.childName])).toEqual([
      ['pickup', 'chref_zainab', 'زينب'],
      ['dropoff', 'chref_zainab', 'زينب'],
    ]);
    expect(asked).toEqual([{ driverId: 'k1', refs: ['chref_zainab'] }]);
    expect(await code(rpc.runSheet({ personId: 'k2', sessionId: 's' }, { tripId: t.id }))).toBe('forbidden');
    expect(asked).toHaveLength(1);
  });
});

describe('TripsService — unreachable protocol', () => {
  async function atDoor() {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    const [pickup, dropoff] = t.stops;
    await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen });
    await h.trips.completeStop(t.id, pickup!.id, 'd1');
    await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home });
    return { h, t, dropoff: dropoff! };
  }

  it('dispatcher card at 3:00 by a delayed job, "فشل" armed at 5:00', async () => {
    const { h, t, dropoff } = await atDoor();
    const started = await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    expect(started.unreachable).toMatchObject({ stopId: dropoff.id, escalatedAt: null });
    expect(h.queue.size).toBe(2);
    await h.advance(179_000);
    expect(h.events.ofType('trip.unreachable_escalated')).toHaveLength(0);
    await h.advance(1_000);
    expect(h.events.ofType('trip.unreachable_escalated')).toHaveLength(1);
    expect((await h.trips.get(t.id)).unreachable!.escalatedAt).toEqual(h.clock.now());
    await h.advance(120_000);
    expect(h.events.ofType('trip.unreachable_fail_allowed')).toHaveLength(1);
  });

  it('driver fail allowed only at 5:00; dispatcher from 3:00', async () => {
    const { h, t, dropoff } = await atDoor();
    expect(await code(h.trips.fail(t.id, { personId: 'd1', role: 'driver' }))).toBe('unreachable_not_started');
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    await h.advance(179_000);
    expect(await code(h.trips.fail(t.id, { personId: 'disp', role: 'dispatcher' }))).toBe('unreachable_too_early');
    await h.advance(1_000);
    expect(await code(h.trips.fail(t.id, { personId: 'd1', role: 'driver' }))).toBe('unreachable_too_early');
    await h.advance(119_000);
    expect(await code(h.trips.fail(t.id, { personId: 'd1', role: 'driver' }))).toBe('unreachable_too_early');
    await h.advance(1_000);
    const failed = await h.trips.fail(t.id, { personId: 'd1', role: 'driver' });
    expect(failed.state).toBe('failed');
    expect(h.events.last('trip.failed')!.payload).toMatchObject({ reason: 'unreachable', by: 'driver', orderIds: ['ord_1'], failedOrderId: 'ord_1' });
  });

  it('dispatcher may fail at exactly 3:00', async () => {
    const { h, t, dropoff } = await atDoor();
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    await h.advance(180_000);
    expect((await h.trips.fail(t.id, { personId: 'disp', role: 'dispatcher' })).state).toBe('failed');
  });

  it('a hand-over during the countdown ends the protocol; late timer jobs do nothing', async () => {
    const { h, t, dropoff } = await atDoor();
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    await h.advance(60_000);
    const done = await h.trips.completeStop(t.id, dropoff.id, 'd1');
    expect(done.state).toBe('completed');
    expect(done.unreachable).toBeNull();
    await h.advance(10 * 60_000);
    expect(h.events.ofType('trip.unreachable_escalated')).toHaveLength(0);
  });

  it('J-D8 «أني نازل»: 2 more minutes, once; the courier fails from 7:00 and the 5:00 job stays quiet', async () => {
    const { h, t, dropoff } = await atDoor();
    expect(await code(h.trips.extendUnreachable(t.id, 'ord_1', 'c1'))).toBe('unreachable_not_active');
    const started = await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    const startedAt = started.unreachable!.startedAt.getTime();
    await h.advance(60_000);
    const first = await h.trips.extendUnreachable(t.id, 'ord_1', 'c1');
    expect(first.extended).toBe(true);
    expect(first.trip.unreachable).toMatchObject({ extendedAt: h.clock.now() });
    expect(first.trip.unreachable!.failAllowedAt.getTime()).toBe(startedAt + 7 * 60_000);
    expect(h.events.last('trip.unreachable_extended')!.payload).toMatchObject({ stopId: dropoff.id, byCustomer: 'c1', extraMs: 120_000 });
    // Once per stop: a second tap changes nothing.
    await h.advance(30_000);
    const again = await h.trips.extendUnreachable(t.id, 'ord_1', 'c1');
    expect(again.extended).toBe(false);
    expect(again.trip.unreachable!.failAllowedAt.getTime()).toBe(startedAt + 7 * 60_000);
    expect(h.events.ofType('trip.unreachable_extended')).toHaveLength(1);
    // The dispatcher's 3:00 rule is unchanged.
    await h.advance(90_000);
    expect(h.events.ofType('trip.unreachable_escalated')).toHaveLength(1);
    // 5:00: the original job announces nothing, the driver may not fail yet.
    await h.advance(120_000);
    expect(h.events.ofType('trip.unreachable_fail_allowed')).toHaveLength(0);
    expect(await code(h.trips.fail(t.id, { personId: 'd1', role: 'driver' }))).toBe('unreachable_too_early');
    // 7:00: armed.
    await h.advance(120_000);
    expect(h.events.ofType('trip.unreachable_fail_allowed')).toHaveLength(1);
    expect((await h.trips.fail(t.id, { personId: 'd1', role: 'driver' })).state).toBe('failed');
  });

  it('J-D8: only for the order whose door the courier is at, and the hand-over clears it', async () => {
    const { h, t, dropoff } = await atDoor();
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    expect(await code(h.trips.extendUnreachable(t.id, 'ord_other', 'c1'))).toBe('unreachable_not_active');
    await h.trips.extendUnreachable(t.id, 'ord_1', 'c1');
    const done = await h.trips.completeStop(t.id, dropoff.id, 'd1');
    expect(done.unreachable).toBeNull();
    await h.advance(10 * 60_000);
    expect(h.events.ofType('trip.unreachable_fail_allowed')).toHaveLength(0);
  });

  it('batched trip: only the unreachable order fails, the trip carries on', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip('ord_a');
    await h.trips.attachOrder(t.id, { orderId: 'ord_b', stops: h.deliveryStops('ord_b', PINS.kitchen, PINS.home2) });
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'tuktuk' });
    const stops = (await h.trips.get(t.id)).stops;
    const [pa, da, pb, db] = [stops[0]!, stops[1]!, stops[2]!, stops[3]!];
    for (const p of [pa, pb]) {
      await h.trips.arrive(t.id, p.id, 'd1', { pin: PINS.kitchen });
      await h.trips.completeStop(t.id, p.id, 'd1');
    }
    await h.trips.arrive(t.id, da.id, 'd1', { pin: PINS.home });
    await h.trips.startUnreachable(t.id, da.id, 'd1');
    await h.advance(300_000);
    const after = await h.trips.fail(t.id, { personId: 'd1', role: 'driver' });
    expect(after.state).toBe('in_transit');
    expect(after.orders.find((o) => o.orderId === 'ord_a')!.reason).toBe('unreachable_failed');
    expect(h.events.last('trip.order_failed')!.orderId).toBe('ord_a');
    await h.trips.arrive(t.id, db.id, 'd1', { pin: PINS.home2 });
    expect((await h.trips.completeStop(t.id, db.id, 'd1')).state).toBe('completed');
  });
});

describe('TripsService — order links (attach/detach history)', () => {
  it('keeps attach/detach history and answers detachedAt for late-replay quarantine', async () => {
    const h = tripsHarness();
    const t = await h.foodTrip('ord_a');
    h.clock.advanceSeconds(30);
    await h.trips.attachOrder(t.id, { orderId: 'ord_b', stops: h.deliveryStops('ord_b') }, 'disp', 'batched');
    h.clock.advanceSeconds(30);
    const detachAt = h.clock.now();
    const after = await h.trips.detachOrder(t.id, 'ord_a', 'disp', 'reassigned');
    expect(after.state).toBe('created');
    expect(after.orders.map((o) => [o.orderId, o.detachedAt?.toISOString() ?? null, o.reason])).toEqual([
      ['ord_a', detachAt.toISOString(), 'reassigned'],
      ['ord_b', null, 'batched'],
    ]);
    expect(after.stops.filter((s) => s.orderId === 'ord_a').every((s) => s.state === 'skipped')).toBe(true);
    expect(await h.trips.detachedAt(t.id, 'ord_a')).toEqual(detachAt);
    expect(await h.trips.detachedAt(t.id, 'ord_b')).toBeNull();
    expect(await h.repo.detachedAt(t.id, 'ord_a')).toEqual(detachAt);

    // reassignment: the order moves to a new trip; history spans both
    const t2 = await h.trips.createForOrders({ cityId: 'aziziyah', vertical: 'food', orders: [{ orderId: 'ord_a' }], stops: h.deliveryStops('ord_a') });
    expect((await h.trips.orderHistory('ord_a')).map((l) => [l.tripId, l.detachedAt === null])).toEqual([
      [t.id, false],
      [t2.id, true],
    ]);
    expect((await h.trips.activeForOrder('ord_a'))!.id).toBe(t2.id);
    // detaching twice is a no-op
    await h.trips.detachOrder(t.id, 'ord_a', 'disp', 'again');
    expect(h.events.ofType('trip.order_detached')).toHaveLength(1);
  });

  it('an offline tap replayed after the order was detached is recorded as evidence, not refused (simulator regression, edge-case §10)', async () => {
    // Found by the Aziziyah simulator: a courier offline at the kitchen had his job reassigned; his
    // queued "وصلت" came back as stop_state_conflict and the evidence was lost instead of quarantined.
    const h = tripsHarness();
    const t = await h.foodTrip('ord_a');
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    const [pickup] = (await h.trips.get(t.id)).stops;
    const tappedAt = h.clock.now();
    h.clock.advance(5 * 60_000);
    await h.trips.cancel(t.id, 'platform', 'disp', 'courier_offline');
    h.clock.advance(3 * 60_000);
    const stamp = { occurredAt: tappedAt, deviceUptimeMs: 3_600_000, idempotencyKey: 'd1.7' };
    const view = await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen, ...stamp });
    expect(view.stops[0]).toMatchObject({ state: 'skipped', arrivedAt: null });
    const replay = h.events.ofType('stop.arrived').at(-1)!;
    expect(replay).toMatchObject({ orderId: 'ord_a', deviceUptimeMs: 3_600_000, occurredAt: tappedAt, idempotencyKey: `stop.arrived:d1:trip:${t.id}/stop:${pickup!.id}:d1.7` });
    await h.trips.completeStop(t.id, pickup!.id, 'd1', { ...stamp, idempotencyKey: 'd1.8' });
    expect(h.events.ofType('stop.completed')).toHaveLength(1);
    // Without device evidence (a live tap, not a replay) a skipped stop is still a conflict.
    expect(await code(h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen }))).toBe('stop_state_conflict');
  });

  it('an order cannot ride two live trips at once', async () => {
    const h = tripsHarness();
    await h.foodTrip('ord_a');
    expect(await code(h.foodTrip('ord_a'))).toBe('trip_state_conflict');
  });

  it('detaching the last order cancels the trip on behalf of the platform', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip('ord_a');
    const after = await h.trips.detachOrder(t.id, 'ord_a', 'system', 'order_cancelled');
    expect(after.state).toBe('platform_cancelled');
    expect(h.events.last('trip.cancelled')!.payload).toMatchObject({ by: 'platform', reason: 'all_orders_detached' });
  });

  it('cancel skips unfinished stops, detaches every order and carries fee inputs on the event', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip('ord_a', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    await h.trips.arrive(t.id, t.stops[0]!.id, 'd1', { pin: PINS.kitchen });
    const c = await h.trips.cancel(t.id, 'driver', 'd1', 'rider_no_show');
    expect(c.state).toBe('driver_cancelled');
    expect(c.stops.every((s) => s.state === 'skipped')).toBe(true);
    expect(c.orders[0]!.detachedAt).toEqual(h.clock.now());
    expect(h.events.last('trip.cancelled')!.payload).toMatchObject({ by: 'driver', orderIds: ['ord_a'], arrivedPickupAt: h.clock.now().toISOString() });
    expect(await code(h.trips.cancel(t.id, 'platform', 'disp', 'x'))).toBe('trip_state_conflict');
  });

  it("endedForDriver lists the trips he completed or cancelled since a time (his scorecard's); forDriver only the unfinished", async () => {
    const h = tripsHarness();
    const start = h.clock.now();
    const done = await h.acceptedTrip('ord_a');
    await h.trips.arrive(done.id, done.stops[0]!.id, 'd1', { pin: PINS.kitchen });
    await h.trips.completeStop(done.id, done.stops[0]!.id, 'd1', { handover: { pickupCode: '0000' } });
    await h.trips.arrive(done.id, done.stops[1]!.id, 'd1', { pin: PINS.home });
    await h.trips.completeStop(done.id, done.stops[1]!.id, 'd1', { handover: { cashCollectedIqd: 16500 } });
    h.clock.advance(60_000);
    const dropped = await h.acceptedTrip('ord_b');
    await h.trips.cancel(dropped.id, 'driver', 'd1', 'vehicle_problem');
    h.clock.advance(60_000);
    const pulled = await h.acceptedTrip('ord_c');
    await h.trips.cancel(pulled.id, 'platform', 'disp', 'test');
    h.clock.advance(60_000);
    const going = await h.acceptedTrip('ord_d');

    expect((await h.trips.endedForDriver('d1', start)).map((t) => [t.id, t.state])).toEqual([
      [done.id, 'completed'],
      [dropped.id, 'driver_cancelled'],
    ]);
    expect((await h.trips.forDriver('d1')).map((t) => t.id)).toEqual([going.id]);
    // Only trips that ended at or after `since`.
    expect((await h.trips.endedForDriver('d1', new Date(start.getTime() + 30_000))).map((t) => t.id)).toEqual([dropped.id]);
    expect(await h.trips.endedForDriver('d2', start)).toEqual([]);
  });
});

describe('TripsService — rides', () => {
  async function rideInTransit() {
    const h = tripsHarness();
    const t = await h.acceptedTrip('ride_1', 'd1', { vertical: 'taxi', vehicleClass: 'car' });
    await h.trips.arrive(t.id, t.stops[0]!.id, 'd1', { pin: PINS.kitchen });
    await h.trips.completeStop(t.id, t.stops[0]!.id, 'd1');
    return { h, t };
  }

  it('customer-side completion ends the ride at the locked quote when the driver phone is dead (B.24)', async () => {
    const { h, t } = await rideInTransit();
    const done = await h.trips.customerComplete(t.id, 'c1');
    expect(done.state).toBe('completed');
    expect(done.stops[1]).toMatchObject({ state: 'skipped', skipReason: 'customer_confirmed' });
    expect(h.events.last('trip.completed')!.payload).toMatchObject({ by: 'customer', orderIds: ['ride_1'] });
    expect(h.events.last('trip.completed')!.actorId).toBe('c1');
  });

  it('customer completion is for rides only', async () => {
    const h = tripsHarness();
    const t = await h.acceptedTrip();
    expect(await code(h.trips.customerComplete(t.id, 'c1'))).toBe('trip_state_conflict');
  });

  it('server auto-completes after 10 min silent inside the dropoff geofence', async () => {
    const { h, t } = await rideInTransit();
    await h.trips.reportPosition('d1', { tripId: t.id, pin: offsetNorth(PINS.home, 20), at: h.clock.now() });
    await h.advance(9 * 60_000);
    expect((await h.trips.get(t.id)).state).toBe('in_transit');
    await h.advance(60_000);
    const done = await h.trips.get(t.id);
    expect(done.state).toBe('completed');
    expect(h.events.last('trip.completed')!.payload).toMatchObject({ by: 'system' });
  });

  it('a newer position cancels the pending auto-complete', async () => {
    const { h, t } = await rideInTransit();
    await h.trips.reportPosition('d1', { tripId: t.id, pin: offsetNorth(PINS.home, 20), at: h.clock.now() });
    await h.advance(5 * 60_000);
    await h.trips.reportPosition('d1', { tripId: t.id, pin: offsetNorth(PINS.home, 500), at: h.clock.now() });
    await h.advance(5 * 60_000);
    expect((await h.trips.get(t.id)).state).toBe('in_transit');
  });
});

describe('delivery photos (maps program f11)', () => {
  async function delivered(photoUploadId?: string, owner = 'd1') {
    const h = tripsHarness();
    if (photoUploadId) h.photos.stored.set(photoUploadId, owner);
    const t = await h.acceptedTrip();
    const [pickup, dropoff] = t.stops;
    await h.trips.arrive(t.id, pickup!.id, 'd1', { pin: PINS.kitchen });
    await h.trips.completeStop(t.id, pickup!.id, 'd1');
    await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home });
    return { h, t, dropoff: dropoff! };
  }

  it('only his own stored upload is a delivery photo', async () => {
    const mine = await delivered('up_mine');
    await mine.h.trips.completeStop(mine.t.id, mine.dropoff.id, 'd1', { handover: { photoUploadId: 'up_mine', cashCollectedIqd: 16500 } });
    expect(await mine.h.trips.handoverPhotoUrl(mine.dropoff.orderId!)).toBe('https://api.test/files/up_mine?sig=x');

    const theirs = await delivered('up_other', 'someone_else');
    expect(await code(theirs.h.trips.completeStop(theirs.t.id, theirs.dropoff.id, 'd1', { handover: { photoUploadId: 'up_other' } }))).toBe('handover_photo_invalid');
  });

  it('30 days on, the photo is deleted and the stop keeps when it went', async () => {
    const { h, t, dropoff } = await delivered('up_mine');
    await h.trips.completeStop(t.id, dropoff.id, 'd1', { handover: { photoUploadId: 'up_mine', cashCollectedIqd: 16500 } });
    const cutoff = (days: number) => new Date(h.clock.now().getTime() - days * 86_400_000);
    expect(await h.trips.purgeHandoverPhotos(cutoff(30), 10)).toBe(0);
    h.clock.advance(31 * 86_400_000);
    expect(await h.trips.purgeHandoverPhotos(cutoff(30), 10)).toBe(1);
    expect(h.photos.removed).toEqual(['up_mine']);
    const stop = (await h.trips.get(t.id)).stops.find((s) => s.id === dropoff.id)!;
    expect(stop.handoverProof).not.toHaveProperty('photoUploadId');
    expect(stop.handoverProof).toHaveProperty('photoPurgedAt');
    expect(await h.trips.handoverPhotoUrl(dropoff.orderId!)).toBeNull();
  });
});
