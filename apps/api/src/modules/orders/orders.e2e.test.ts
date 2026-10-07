import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { HOME, KITCHEN, fakePhoneHash, ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Orders and trips together (plan Step 4 "end-to-end integration"): every order state change
 * below is driven by real trip events delivered through the fake outbox.
 */
describe('orders × trips — end to end', () => {
  it('cash food order: placed → accepted → preparing → ready → picked up → delivered → closed, with cash account and points', async () => {
    const h = ordersHarness();
    const o = await h.orders.place(
      'c1',
      h.foodInput({
        participants: [{ ref: 'sis', role: 'diner', phone: '07709998877' }],
        lines: [
          { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000 },
          { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000, participantRef: 'sis' },
        ],
      }),
    );
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.orders.markPreparing('m1', { orderId: o.id });
    await h.orders.markReady('m1', { orderId: o.id });
    await h.pickup(t.id);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    await h.dropoff(t.id, { cashCollectedIqd: 16500 });

    const delivered = await h.orders.get(o.id);
    expect(delivered.state).toBe('delivered');
    expect((await h.trips.get(t.id)).state).toBe('completed');
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ amountIqd: 16500, discrepancyIqd: 0, courierId: 'd1' });
    // Edge-case §3: merchant_payable net of commission, created the moment the courier collects.
    expect(h.events.last('merchant.payable_accrued')!.payload).toMatchObject({ merchantOrgId: 'rest_1', grossIqd: 15000, commissionIqd: 2250, netIqd: 12750, heldBy: 'courier' });

    await h.advance(2 * HOUR - 1000);
    expect((await h.orders.get(o.id)).state).toBe('delivered');
    await h.advance(1000);
    expect((await h.orders.get(o.id)).state).toBe('closed');
    // Revenue 500 service + 2,250 commission = 2,750 → 27 points; the sister's line is a third of the value.
    expect(h.events.last('order.points_allocated')!.payload).toMatchObject({ platformRevenueIqd: 2750, basePoints: 27 });
    expect(h.events.last('points.pending')!.payload).toMatchObject({ phoneHash: fakePhoneHash('07709998877'), points: 9 });
    expect(h.events.types(o.id)).toEqual([
      'order.placed',
      'line.tagged',
      'order.offered_to_merchant',
      'order.accepted',
      'order.preparing',
      'order.ready',
      'order.picked_up',
      'order.delivered',
      'order.cash_collected',
      'merchant.payable_accrued',
      'order.closed',
      'order.points_allocated',
      'points.pending',
    ]);
  });

  it('pickup while the kitchen never tapped ready implies ready', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    expect(h.events.last('order.ready')!.payload).toMatchObject({ implied: true });
  });

  it('replaying a trip event changes nothing (at-least-once delivery)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    await h.dropoff(t.id);
    const before = h.events.events.length;
    for (const e of h.tripEvents.events) {
      await h.orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload });
    }
    expect(h.events.events.length).toBe(before);
  });

  it('a rating keeps the complaint window open (FLOW-20); a dispute is possible until closed, support only after', async () => {
    const h = ordersHarness();
    const a = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: a.id, prepMinutes: 15 });
    const ta = await h.tripFor(a.id);
    await h.pickup(ta.id);
    await h.dropoff(ta.id);
    const disputed = await h.orders.openDispute('c1', { orderId: a.id, kind: 'cold_or_late', note: 'وصل بارد' });
    expect(disputed.state).toBe('disputed');
    expect(h.events.last('order.disputed')!.payload).toMatchObject({ kind: 'cold_or_late', openedBy: 'customer' });
    await h.advance(3 * HOUR);
    expect((await h.orders.get(a.id)).state).toBe('disputed'); // auto-close skips disputed orders

    const b = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: b.id, prepMinutes: 15 });
    const tb = await h.tripFor(b.id, { driverId: 'd2' });
    await h.pickup(tb.id, 'd2');
    await h.dropoff(tb.id, { driverId: 'd2' });
    expect((await h.orders.rate('c1', { orderId: b.id })).state).toBe('delivered');
    // FLOW-20: rated at the door, a missing item found later can still be complained about…
    h.clock.advance(HOUR);
    expect((await h.orders.openDispute('c1', { orderId: b.id, kind: 'missing_item' })).state).toBe('disputed');

    const c = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: c.id, prepMinutes: 15 });
    const tc = await h.tripFor(c.id, { driverId: 'd3' });
    await h.pickup(tc.id, 'd3');
    await h.dropoff(tc.id, { driverId: 'd3' });
    await h.orders.rate('c1', { orderId: c.id, delivery: 5 });
    // …and the 2-h auto-close ends the window as before.
    await h.advance(3 * HOUR);
    expect((await h.orders.get(c.id)).state).toBe('closed');
    expect(await code(h.orders.openDispute('c1', { orderId: c.id, kind: 'missing_item' }))).toBe('dispute_window_closed');
  });

  it('unreachable customer: driver fails at 5:00 and the order is disputed with the food default (customer owes cost)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const dropoff = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, dropoff.id, 'd1', { pin: HOME });
    await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    await h.advance(5 * MIN);
    await h.trips.fail(t.id, { personId: 'd1', role: 'driver' });
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('disputed');
    expect(h.events.last('order.disputed')!.payload).toMatchObject({ kind: 'unreachable', defaultOutcome: 'customer_owes_cost', openedBy: 'system' });
  });

  it('«أني نازل» (J-D8): the orderer buys 2 more minutes once; strangers cannot; outside the countdown it is refused', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const dropoff = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, dropoff.id, 'd1', { pin: HOME });
    expect(await code(h.orders.comingOut('c1', { orderId: o.id }))).toBe('unreachable_not_active');
    const started = await h.trips.startUnreachable(t.id, dropoff.id, 'd1');
    expect(await code(h.orders.comingOut('stranger', { orderId: o.id }))).toBe('forbidden');
    const first = await h.orders.comingOut('c1', { orderId: o.id });
    expect(first.extended).toBe(true);
    expect(first.failAllowedAt.getTime()).toBe(started.unreachable!.startedAt.getTime() + 7 * MIN);
    expect((await h.orders.comingOut('c1', { orderId: o.id })).extended).toBe(false);
    await h.advance(5 * MIN);
    expect(await code(h.trips.fail(t.id, { personId: 'd1', role: 'driver' }))).toBe('unreachable_too_early');
    await h.advance(2 * MIN);
    await h.trips.fail(t.id, { personId: 'd1', role: 'driver' });
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('disputed');
  });

  it('courier cancels after pickup: dispute, courier pays the food cost', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    await h.trips.cancel(t.id, 'driver', 'd1', 'عطل بالدراجة');
    await h.deliver();
    expect(await h.orders.get(o.id)).toMatchObject({ state: 'disputed' });
    expect(h.events.last('order.disputed')!.payload).toMatchObject({ defaultOutcome: 'courier_pays_food_cost' });
  });

  it('courier cancels before pickup: the order stays with the kitchen and goes back to dispatch', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.trips.cancel(t.id, 'driver', 'd1', 'بنزين');
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
    // Simulator regression: the event now carries what dispatch needs to find the next courier.
    expect(h.events.last('order.courier_unassigned')!.payload).toMatchObject({
      by: 'driver',
      redispatch: true,
      orderType: 'food',
      cityId: 'aziziyah',
      merchantOrgId: 'rest_1',
      promisedReadyAt: expect.any(String),
      dropoff: { zoneKey: 'zakur', pin: HOME },
      paymentMethod: 'cash',
      totalIqd: o.totalIqd,
    });
    // and a fresh courier can take it
    const t2 = await h.tripFor(o.id, { driverId: 'd2' });
    expect(t2.courierId).toBe('d2');
  });

  it('a night delivery fee (+250): the 250-step total is collected as is and nobody owes (simulator regression)', async () => {
    // Found by the Aziziyah simulator: the ledger rounded a 16,750 night order up to 17,000 and the
    // customer, who paid the 16,750 he was shown, was left owing 250. The server quotes the +250 at night.
    const h = ordersHarness('2026-10-03T21:30:00Z'); // 00:30 Baghdad
    const night = await h.orders.place('c1', h.foodInput({ deliveryFeeIqd: 1250 }));
    expect(night.totalIqd % 500).toBe(250);
    await h.orders.merchantAccept('m1', { orderId: night.id, prepMinutes: 15 });
    const t = await h.tripFor(night.id);
    await h.pickup(t.id);
    await h.dropoff(t.id, { cashCollectedIqd: night.totalIqd });
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ order: { cashCollectedIqd: night.totalIqd } });
    expect(night.changeIqd).toBe(0);

    h.clock.set(Date.parse('2026-10-04T09:00:00Z')); // next day, 12:00 Baghdad
    const day = await h.orders.place('c2', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: day.id, prepMinutes: 15 });
    const t2 = await h.tripFor(day.id, { driverId: 'd2' });
    await h.pickup(t2.id, 'd2');
    await h.dropoff(t2.id, { cashCollectedIqd: day.totalIqd, driverId: 'd2' });
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ order: { cashCollectedIqd: day.totalIqd } });
  });

  it('order cap reaches the trip: a bike cannot accept a car-sized order', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'tray', qty: 7, unitPriceIqd: 10000 }] }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 30 });
    expect(await code(h.tripFor(o.id, { vehicleClass: 'bike' }))).toBe('vehicle_too_small');
  });
});

describe('orders × trips — rides', () => {
  async function ride() {
    const h = ordersHarness();
    h.people.set('07705554433', 'p_mum');
    const o = await h.orders.place('c1', {
      cityId: 'aziziyah',
      type: 'ride',
      fareIqd: 3000,
      pickup: { zoneKey: 'centre', pin: KITCHEN },
      dropoff: { zoneKey: 'street_30', pin: HOME },
      participants: [{ ref: 'mum', role: 'rider', phone: '07705554433' }],
    });
    expect(o).toMatchObject({ state: 'placed', totalIqd: 3000, minVehicleClass: null });
    return { h, o };
  }

  it('matched on accept; the rider (booked by someone else) confirms arrival and the ride completes', async () => {
    const { h, o } = await ride();
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    expect((await h.orders.get(o.id)).state).toBe('matched');
    await h.pickup(t.id);
    expect(await code(h.orders.confirmRideArrived('stranger', { orderId: o.id }))).toBe('forbidden');
    const done = await h.orders.confirmRideArrived('p_mum', { orderId: o.id });
    expect(done.state).toBe('completed');
    expect((await h.trips.get(t.id)).state).toBe('completed');
    const before = h.events.events.length;
    await h.deliver(); // trip.completed arrives later — nothing more happens
    expect(h.events.events.length).toBe(before);
    await h.advance(2 * HOUR);
    expect((await h.orders.get(o.id)).state).toBe('closed');
    // Ride points go to the rider: 12 % of 3,000 = 360 → 1 point per 200.
    expect(h.events.last('order.points_allocated')!.payload).toMatchObject({ basePoints: 1 });
    expect((h.events.last('order.points_allocated')!.payload['allocations'] as Array<{ personId: string }>)[0]!.personId).toBe('p_mum');
  });

  it('driver drop-off at the door completes the ride order too', async () => {
    const { h, o } = await ride();
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    await h.pickup(t.id);
    await h.dropoff(t.id);
    expect((await h.orders.get(o.id)).state).toBe('completed');
  });

  it('customer cancel: free within 60 s of accept, 500 to the driver after, and the trip is cancelled', async () => {
    const { h, o } = await ride();
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    expect((await h.orders.cancellationPreview(o.id)).free).toBe(true);
    await h.advance(61_000);
    const fee = await h.orders.cancellationPreview(o.id);
    expect(fee).toMatchObject({ amountIqd: 500, splits: [{ to: 'driver', amountIqd: 500 }] });
    const c = await h.orders.cancel('c1', { orderId: o.id });
    expect(c).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 500 });
    expect((await h.trips.get(t.id)).state).toBe('customer_cancelled');
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('customer_cancelled');
  });

  it('driver cancels after arriving: 500 credit to the customer from the driver, the ride goes back to dispatch', async () => {
    const { h, o } = await ride();
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    const pickup = t.stops.find((s) => s.type === 'pickup')!;
    await h.trips.arrive(t.id, pickup.id, 'd1', { pin: KITCHEN });
    await h.trips.cancel(t.id, 'driver', 'd1', 'ما طلع');
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('placed');
    expect(h.events.last('order.driver_cancelled')!.payload).toMatchObject({ customerCreditIqd: 500, creditFundedBy: 'driver', scoringHit: true });
    expect(h.events.ofType('order.rematch_needed')).toHaveLength(1);
  });
});
