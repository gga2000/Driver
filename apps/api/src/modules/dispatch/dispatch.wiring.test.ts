import { describe, expect, it } from 'vitest';
import { encodeDomainEvent, type DomainEventInput } from '@driver/contracts';
import { DispatchSubscribers } from './events.subscribers.js';
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

  it('order.courier_unassigned with redispatch builds a new courier trip and requests again (simulator regression)', async () => {
    // Found by the Aziziyah simulator: when the platform took a job off a courier who went dark,
    // orders announced `redispatch: true` and nobody listened — the food sat "ready" forever.
    const h = dispatchHarness();
    await h.online('k1', 0.3, { vehicle: 'bike' });
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    const payload: DomainEventInput<'order.courier_unassigned'> = {
      tripId: 'trip-old',
      by: 'platform',
      reason: 'courier_offline',
      redispatch: true,
      orderType: 'food',
      cityId: 'aziziyah',
      merchantOrgId: 'rest_1',
      promisedReadyAt: h.clock.now(),
      minVehicleClass: 'bike',
      pickup: { zoneKey: 'centre', pin: north(0) },
      dropoff: { zoneKey: 'street_30' },
      paymentMethod: 'cash',
      totalIqd: 16_500,
    };
    const event = { orderId: 'ord_1', aggregateId: 'ord_1', payload: encodeDomainEvent('order.courier_unassigned', payload) };
    await subs.onCourierUnassigned(event);
    expect(h.trips.created).toEqual([expect.objectContaining({ orderId: 'ord_1', vertical: 'food', pickup: { zoneKey: 'centre', pin: north(0) }, dropoff: { zoneKey: 'street_30' } })]);
    expect(await h.service.getRequest('trip-ord_1')).toMatchObject({ policy: 'auto_assign', cashIqd: 16_500, dropoffZoneId: 'street_30' });
    expect(h.trips.offeredTo('trip-ord_1')).toEqual(['k1']); // ready already: the first courier is offered at once
    await subs.onCourierUnassigned(event); // redelivery: same live trip, same live request
    expect(h.trips.offeredTo('trip-ord_1')).toEqual(['k1']);

    const ride = { ...event, orderId: 'ord_2', payload: encodeDomainEvent('order.courier_unassigned', { ...payload, orderType: 'ride' }) };
    const no = { ...event, orderId: 'ord_3', payload: encodeDomainEvent('order.courier_unassigned', { ...payload, redispatch: false }) };
    await subs.onCourierUnassigned(ride);
    await subs.onCourierUnassigned(no);
    expect(h.trips.created).toHaveLength(2);
  });
});

/** Errands and parcels have no merchant to accept them: dispatch starts the courier on `order.placed`. */
describe('dispatch on order.placed for parcels and errands', () => {
  const SENDER_DOOR = { zoneKey: 'zakur', pin: north(1) };
  const placed = (orderId: string, extra: Record<string, unknown> = {}) => ({
    orderId,
    aggregateId: orderId,
    // The shape orders emits (orders.service `order.placed`), errand / parcel part included.
    payload: { type: 'parcel', cityId: 'aziziyah', merchantOrgId: null, totalIqd: 3_500, itemsTotalIqd: 0, paymentMethod: 'cash', minVehicleClass: null, scheduledFor: null, pickup: SENDER_DOOR, dropoff: { zoneKey: 'street_30' }, ...extra },
  });
  const requested = (h: H) => h.events.ofType('dispatch.requested');

  it('a placed parcel gets exactly one courier request from the sender’s door, even when the event is delivered twice', async () => {
    const h = dispatchHarness();
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    const e = placed('ord_p1');
    await subs.onCourierPlaced(e);
    await subs.onCourierPlaced(e); // outbox redelivery
    expect(h.trips.created[0]).toEqual(expect.objectContaining({ orderId: 'ord_p1', vertical: 'parcel', pickup: SENDER_DOOR, dropoff: { zoneKey: 'street_30' } }));
    expect(requested(h)).toHaveLength(1);
    expect(await h.service.getRequest('trip-ord_p1')).toMatchObject({ vertical: 'parcel', policy: 'smart_broadcast', zoneId: 'zakur', pickup: north(1), dropoffZoneId: 'street_30', hot: false, readyAt: null, cashIqd: 3_500 });
  });

  it('a placed errand gets one courier request from the shop', async () => {
    const h = dispatchHarness();
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    await subs.onCourierPlaced(placed('ord_e1', { type: 'errand', itemsTotalIqd: 7_000, totalIqd: 9_000, pickup: { zoneKey: 'centre' } }));
    expect(h.trips.created).toEqual([expect.objectContaining({ orderId: 'ord_e1', vertical: 'errand', pickup: { zoneKey: 'centre' } })]);
    expect(requested(h)).toHaveLength(1);
    expect(await h.service.getRequest('trip-ord_e1')).toMatchObject({ vertical: 'errand', policy: 'auto_assign', hot: false, readyAt: null });
  });

  it('placed food (and rides) get no courier request; a parcel booked for later waits (no scheduled search yet)', async () => {
    const h = dispatchHarness();
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    await subs.onCourierPlaced(placed('ord_f1', { type: 'food', merchantOrgId: 'rest_1', pickup: undefined, dropoff: undefined }));
    await subs.onCourierPlaced(placed('ord_g1', { type: 'grocery_catalog', merchantOrgId: 'shop_1' }));
    await subs.onCourierPlaced(placed('ord_r1', { type: 'ride', ride: { vertical: 'taxi', pickup: SENDER_DOOR, dropoff: null, quoteId: null } }));
    await subs.onCourierPlaced(placed('ord_s1', { scheduledFor: '2026-10-03T15:00:00.000Z' }));
    expect(h.trips.created).toEqual([]);
    expect(requested(h)).toEqual([]);
  });

  it('accepted food is unchanged: courier from the kitchen, hot, timed to the promised ready time', async () => {
    const h = dispatchHarness();
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    const readyAt = new Date(h.clock.now().getTime() + 15 * 60_000);
    const accepted: DomainEventInput<'order.accepted'> = {
      from: 'placed',
      to: 'merchant_accepted',
      orderType: 'food',
      cityId: 'aziziyah',
      merchantOrgId: 'rest_1',
      prepMinutes: 15,
      promisedReadyAt: readyAt,
      minVehicleClass: 'bike',
      auto: false,
      partial: false,
      pickup: { zoneKey: 'centre', pin: north(0) },
      dropoff: { zoneKey: 'street_30' },
      paymentMethod: 'cash',
      totalIqd: 16_500,
    };
    await subs.onOrderAccepted({ type: 'order.accepted', orderId: 'ord_a1', aggregateId: 'ord_a1', payload: encodeDomainEvent('order.accepted', accepted) });
    expect(h.trips.created).toEqual([expect.objectContaining({ orderId: 'ord_a1', vertical: 'food', minVehicleClass: 'bike', pickup: { zoneKey: 'centre', pin: north(0) } })]);
    expect(await h.service.getRequest('trip-ord_a1')).toMatchObject({ vertical: 'food', policy: 'auto_assign', hot: true, readyAt: readyAt.getTime(), cashIqd: 16_500 });
    // …and its order.placed starts nothing.
    await subs.onCourierPlaced(placed('ord_a1', { type: 'food', merchantOrgId: 'rest_1' }));
    expect(requested(h)).toHaveLength(1);
  });

  it('a parcel its courier dropped before pickup gets exactly one new request from its own pickup; one dropped after pickup gets none', async () => {
    const h = dispatchHarness();
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    const unassigned = (orderId: string, extra: Partial<DomainEventInput<'order.courier_unassigned'>> = {}) => ({
      orderId,
      aggregateId: orderId,
      payload: encodeDomainEvent('order.courier_unassigned', {
        tripId: 'trip-old',
        by: 'driver',
        reason: null,
        redispatch: true,
        orderType: 'parcel',
        cityId: 'aziziyah',
        merchantOrgId: null,
        promisedReadyAt: null,
        minVehicleClass: null,
        pickup: SENDER_DOOR,
        dropoff: { zoneKey: 'street_30' },
        paymentMethod: 'cash',
        totalIqd: 3_500,
        ...extra,
      }),
    });
    const before = unassigned('ord_p2');
    await subs.onCourierUnassigned(before);
    await subs.onCourierUnassigned(before); // outbox redelivery: same live trip, same live request
    expect(h.trips.created[0]).toEqual(expect.objectContaining({ orderId: 'ord_p2', vertical: 'parcel', pickup: SENDER_DOOR }));
    expect(requested(h)).toHaveLength(1);
    expect(await h.service.getRequest('trip-ord_p2')).toMatchObject({ vertical: 'parcel', zoneId: 'zakur', pickup: north(1), hot: false, readyAt: null });

    // Already picked up (orders sends redispatch: false), or no pickup point on file: no new search.
    await subs.onCourierUnassigned(unassigned('ord_p3', { redispatch: false }));
    await subs.onCourierUnassigned(unassigned('ord_e3', { orderType: 'errand', pickup: null }));
    expect(requested(h)).toHaveLength(1);
  });
});
