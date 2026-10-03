import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { offsetNorth } from './geofence.js';
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
    expect((await h.trips.completeStop(t.id, pickup!.id, 'd1')).state).toBe('in_transit');
    expect((await h.trips.arrive(t.id, dropoff!.id, 'd1', { pin: PINS.home })).state).toBe('arrived_dropoff');
    const done = await h.trips.completeStop(t.id, dropoff!.id, 'd1', { handover: { cashCollectedIqd: 16500, photoUrl: 'https://cdn.example/p.jpg' } });
    expect(done.state).toBe('completed');
    expect(done.completedAt).toEqual(h.clock.now());
    expect(h.events.last('stop.completed')!.payload).toMatchObject({ stopType: 'dropoff', cashCollectedIqd: 16500, photo: true });
    expect(h.events.last('trip.completed')!.payload).toMatchObject({ by: 'driver', orderIds: ['ord_1'] });
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
    expect(h.events.last('stop.arrived')!.idempotencyKey).toBe('stop.arrived:arr-0001');
  });

  it('khat: a named child cannot be handed over without the tap; tap-out at school notifies the guardian', async () => {
    const h = tripsHarness();
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'khat',
      orders: [{ orderId: 'sub_1' }],
      stops: [
        { orderId: 'sub_1', type: 'pickup', zoneKey: 'zakur', target: PINS.home, childName: 'زينب' },
        { orderId: 'sub_1', type: 'dropoff', zoneKey: 'centre', target: PINS.school, childName: 'زينب' },
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
    expect(h.events.last('khat.child_tapped_out')!.payload).toMatchObject({ childName: 'زينب', notifyGuardian: true });
    expect(h.events.last('khat.child_tapped_in')!.payload).toMatchObject({ notifyGuardian: false });
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
