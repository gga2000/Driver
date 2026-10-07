import { describe, expect, it } from 'vitest';
import { PlaceOrderInput } from '@driver/contracts';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

const PICKUP = { zoneKey: 'centre', pin: KITCHEN };
const DROPOFF = { zoneKey: 'street_30', pin: HOME };

describe('rides: «عندي غراض» (ride idea x5)', () => {
  it('is stored on the ride in chip order, shown back on the order, and never moves the fare', async () => {
    const h = ordersHarness();
    const plain = await h.orders.quote('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF });
    const withBags = await h.orders.quote('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF, rideCargo: ['gas', 'bags'] });
    expect(withBags.totalIqd).toBe(plain.totalIqd);
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'tuktuk', fareIqd: plain.totalIqd, pickup: PICKUP, dropoff: DROPOFF, rideCargo: ['gas', 'bags'] });
    expect(o.rideCargo).toEqual(['bags', 'gas']);
    expect((await h.orders.get(o.id)).rideCargo).toEqual(['bags', 'gas']);
    expect(o.totalIqd).toBe(plain.totalIqd);
  });

  it('a ride without it says nothing (absent, not an empty list)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, pickup: PICKUP, dropoff: DROPOFF });
    expect(o.rideCargo).toBeUndefined();
  });

  it('each kind once, only the three kinds', () => {
    const base = { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, paymentMethod: 'cash', pickup: PICKUP, dropoff: DROPOFF };
    expect(PlaceOrderInput.safeParse({ ...base, rideCargo: ['bags', 'bags'] }).success).toBe(false);
    expect(PlaceOrderInput.safeParse({ ...base, rideCargo: ['sheep'] }).success).toBe(false);
    expect(PlaceOrderInput.safeParse({ ...base, rideCargo: ['bags', 'gas', 'big'] }).success).toBe(true);
  });

  it('switching to the other vehicle carries the bags over', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, pickup: PICKUP, dropoff: DROPOFF, rideCargo: ['big'] });
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
    h.clock.advance(200_000);
    const q = await h.orders.rideSwitchQuote('c1', { orderId: o.id, doorPickup: false });
    const next = await h.orders.switchRideVehicle('c1', { orderId: o.id, doorPickup: false, fareIqd: q.fareIqd, clientRequestId: 'switch-cargo-1' });
    expect(next.rideCargo).toEqual(['big']);
  });
});
