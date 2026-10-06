import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

const PICKUP = { zoneKey: 'centre', pin: KITCHEN };
const DROPOFF = { zoneKey: 'street_30', pin: HOME };
const SEC = 1000;

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

/** A taxi ride placed and still looking for a driver (the trip dispatch builds, offered, nobody accepted). */
async function searching(opts: { participants?: boolean } = {}) {
  const h = ordersHarness();
  if (opts.participants) h.people.set('07705554433', 'p_mum');
  const o = await h.orders.place('c1', {
    cityId: 'aziziyah',
    type: 'ride',
    rideVertical: 'taxi',
    fareIqd: 3000,
    pickup: PICKUP,
    dropoff: DROPOFF,
    ...(opts.participants ? { participants: [{ ref: 'mum', role: 'rider' as const, phone: '07705554433' }] } : {}),
  });
  const t = await h.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'taxi',
    orders: [{ orderId: o.id, minVehicleClass: null }],
    stops: [
      { orderId: o.id, type: 'pickup', zoneKey: PICKUP.zoneKey, target: KITCHEN },
      { orderId: o.id, type: 'dropoff', zoneKey: DROPOFF.zoneKey, target: HOME },
    ],
  });
  await h.trips.offer(t.id);
  const tuktuk = (await h.orders.quote('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF })).totalIqd;
  return { h, o, t, tuktuk };
}

describe('rides: no driver after 3 minutes → the other vehicle at a fresh server quote (J-D7)', () => {
  it('is offered only once the free-cancel time has passed', async () => {
    const { h, o } = await searching();
    expect(await code(h.orders.rideSwitchQuote('c1', { orderId: o.id, doorPickup: false }))).toBe('ride_switch_unavailable');
    h.clock.advance(179 * SEC);
    expect(await code(h.orders.rideSwitchQuote('c1', { orderId: o.id, doorPickup: false }))).toBe('ride_switch_unavailable');
  });

  it('quotes the tuktuk for the same pickup and drop-off at 180 s, priced by the server', async () => {
    const { h, o, tuktuk } = await searching();
    h.clock.advance(180 * SEC);
    const q = await h.orders.rideSwitchQuote('c1', { orderId: o.id, doorPickup: false });
    expect(q).toMatchObject({ vertical: 'tuktuk', fareIqd: tuktuk, totalIqd: tuktuk });
    expect(q.availableAt.getTime()).toBe(o.placedAt.getTime() + 180 * SEC);
    expect(q.fareIqd).not.toBe(3000);
  });

  it('switching cancels the search for free and places the tuktuk ride at the quoted fare', async () => {
    const { h, o, t, tuktuk } = await searching();
    h.clock.advance(200 * SEC);
    const next = await h.orders.switchRideVehicle('c1', { orderId: o.id, doorPickup: false, fareIqd: tuktuk, clientRequestId: 'switch-0001' });
    expect(next).toMatchObject({ type: 'ride', state: 'placed', totalIqd: tuktuk, paymentMethod: 'cash' });
    expect(next.id).not.toBe(o.id);
    expect(await h.orders.get(o.id)).toMatchObject({ state: 'customer_cancelled', cancellationReason: 'switched_vehicle', cancellationFeeIqd: 0 });
    expect((await h.trips.get(t.id)).state).toBe('customer_cancelled');
    const placed = h.events.last('order.placed')!;
    expect(placed.orderId).toBe(next.id);
    expect(placed.payload['ride']).toMatchObject({ vertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF });
    // A retry with the same key answers with the same new ride, nothing placed twice.
    const again = await h.orders.switchRideVehicle('c1', { orderId: o.id, doorPickup: false, fareIqd: tuktuk, clientRequestId: 'switch-0001' });
    expect(again.id).toBe(next.id);
    expect(h.events.types().filter((x) => x === 'order.placed')).toHaveLength(2);
  });

  it('a fare that is not the server quote is price_changed, and the search goes on', async () => {
    const { h, o, tuktuk } = await searching();
    h.clock.advance(200 * SEC);
    expect(await code(h.orders.switchRideVehicle('c1', { orderId: o.id, doorPickup: false, fareIqd: tuktuk + 250, clientRequestId: 'switch-0002' }))).toBe('price_changed');
    expect((await h.orders.get(o.id)).state).toBe('placed');
  });

  it('not once a driver took it, not for someone else, not for a ride booked for another rider', async () => {
    const a = await searching();
    a.h.clock.advance(200 * SEC);
    expect(await code(a.h.orders.rideSwitchQuote('stranger', { orderId: a.o.id, doorPickup: false }))).toBe('forbidden');
    await a.h.trips.accept(a.t.id, 'd1', { vehicleClass: 'car' });
    await a.h.deliver();
    expect(await code(a.h.orders.rideSwitchQuote('c1', { orderId: a.o.id, doorPickup: false }))).toBe('ride_switch_unavailable');

    const b = await searching({ participants: true });
    b.h.clock.advance(200 * SEC);
    expect(await code(b.h.orders.rideSwitchQuote('c1', { orderId: b.o.id, doorPickup: false }))).toBe('ride_switch_unavailable');
  });
});
