import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, decodeDomainEvent, type PlaceOrderInput } from '@driver/contracts';
import { takeOf } from '../ledger/postings.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { DISPATCH_TRIP_EVENTS } from '../dispatch/events.subscribers.js';
import { NOTIFY_EVENT_TYPES } from '../notify/notify.subscribers.js';
import { ORDERS_RULES } from './orders.config.js';
import type { OrdersCashRiskPort } from './orders.service.js';
import { staffHarness } from './staff-harness.js';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

/**
 * طرود «رفضت تستلم» (Ali, 2026-10-12): the receiver refuses, the courier brings the parcel back, and the
 * SENDER pays both trips (the receiver never). One order, one trip; the money posts once at the hand-back.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

type H = ReturnType<typeof ordersHarness>;

/** The sender's parcel from the kitchen pin (centre) to the receiver at HOME (zakur), as parcels places it. */
function parcelInput(patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    cityId: 'aziziyah',
    type: 'parcel',
    pickup: { zoneKey: 'centre', pin: KITCHEN },
    dropoff: { zoneKey: 'zakur', pin: HOME },
    options: { doorPickup: true },
    paymentMethod: 'cash',
    ...patch,
  } as PlaceOrderInput;
}

/** A parcel of `sender`'s, picked up by d1 on a parcel trip, the courier at the receiver's door. */
async function atTheDoor<T extends H>(h: T, sender = 'c1') {
  const o = await h.orders.place(sender, parcelInput());
  const t = await h.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'parcel',
    orders: [{ orderId: o.id }],
    stops: [
      { orderId: o.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
      { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
    ],
  });
  await h.trips.offer(t.id);
  await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
  await h.deliver();
  await h.pickup(t.id);
  const door = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
  await h.trips.arrive(t.id, door.id, 'd1', { pin: HOME });
  await h.deliver();
  return { o: await h.orders.get(o.id), t, door };
}

/** The hand-back stop: arrive at the sender's and hand it over with `cash`. */
async function handBack(h: H, tripId: string, cash: number) {
  const back = (await h.trips.get(tripId)).stops.find((s) => s.type === 'dropoff' && s.state === 'pending')!;
  await h.trips.arrive(tripId, back.id, 'd1', { pin: KITCHEN });
  await h.trips.completeStop(tripId, back.id, 'd1', { handover: { cashCollectedIqd: cash } });
  await h.deliver();
  return back;
}

describe('orders.returnParcel — the sender pays both trips', () => {
  it('prices the trip back on the server as the preview does and adds it to the total, fees and change', async () => {
    const h = ordersHarness();
    const { o, t, door } = await atTheDoor(h);
    expect(o.state).toBe('picked_up');
    // The parcels preview: orders.quote for the same parcel from the receiver's door back to the sender.
    const preview = await h.orders.quote('c1', parcelInput({ pickup: { zoneKey: 'zakur', pin: HOME }, dropoff: { zoneKey: 'centre', pin: KITCHEN } }));

    await h.orders.returnParcel('d1', o.id);
    const after = await h.orders.get(o.id);
    expect(after.returnFareIqd).toBe(preview.totalIqd);
    expect(after.totalIqd).toBe(o.totalIqd + preview.totalIqd);
    expect(after.deliveryFeeIqd).toBe(o.deliveryFeeIqd + preview.deliveryFeeIqd);
    expect(after.serviceFeeIqd).toBe(o.serviceFeeIqd + preview.serviceFeeIqd);
    // The breakdown still sums: fees + the cash rounding change = the total.
    expect(after.deliveryFeeIqd + after.serviceFeeIqd + (after.changeIqd ?? 0)).toBe(after.totalIqd);
    expect(after.state).toBe('picked_up');

    // The event carries ids and amounts only.
    const ev = h.events.last('order.parcel_returning')!;
    expect(ev.payload).toEqual({ tripId: t.id, courierId: 'd1', outFareIqd: o.totalIqd, returnFareIqd: preview.totalIqd });

    // One trip: the door skipped for the refusal, a hand-back stop at the sender's, still on the way.
    const trip = await h.trips.get(t.id);
    expect(trip.state).toBe('in_transit');
    expect(trip.stops.find((s) => s.id === door.id)).toMatchObject({ state: 'skipped', skipReason: 'parcel_refused' });
    expect(trip.stops.filter((s) => s.type === 'dropoff' && s.state === 'pending')).toEqual([expect.objectContaining({ zoneKey: 'centre', target: KITCHEN, orderId: o.id })]);
  });

  it('is fixed once priced: a second call (later, at another price) changes nothing and emits nothing', async () => {
    const h = ordersHarness();
    const { o, t } = await atTheDoor(h);
    await h.orders.returnParcel('d1', o.id);
    const first = await h.orders.get(o.id);
    const stops = (await h.trips.get(t.id)).stops;
    const events = h.events.events.length;
    const tripEvents = h.tripEvents.types().length;
    h.clock.advance(12 * 60 * 60_000); // past midnight: a night fee would apply to a new quote
    await h.orders.returnParcel('d1', o.id);
    expect(await h.orders.get(o.id)).toEqual(first);
    expect((await h.trips.get(t.id)).stops).toEqual(stops);
    expect(h.events.events).toHaveLength(events);
    expect(h.tripEvents.types()).toHaveLength(tripEvents);
  });

  it('is refused for a non-parcel, another courier, before pickup, and once delivered or cancelled', async () => {
    const food = ordersHarness();
    const f = await food.orders.place('c1', food.foodInput());
    expect(await code(food.orders.returnParcel('d1', f.id))).toBe('parcel_not_found');

    const h = ordersHarness();
    const { o } = await atTheDoor(h);
    expect(await code(h.orders.returnParcel('d2', o.id))).toBe('not_trip_courier');

    const early = ordersHarness();
    const p = await early.orders.place('c1', parcelInput());
    expect(await code(early.orders.returnParcel('d1', p.id))).toBe('order_state_conflict');

    const done = ordersHarness();
    const d = await atTheDoor(done);
    await done.dropoff(d.t.id, { cashCollectedIqd: d.o.totalIqd });
    expect((await done.orders.get(d.o.id)).state).toBe('delivered');
    expect(await code(done.orders.returnParcel('d1', d.o.id))).toBe('order_state_conflict');

    const gone = ordersHarness();
    const c = await gone.orders.place('c1', parcelInput());
    await gone.orders.cancel('c1', { orderId: c.id });
    expect(await code(gone.orders.returnParcel('d1', c.id))).toBe('order_state_conflict');

    // Nothing was priced on any of them.
    for (const [x, id] of [[food, f.id], [h, o.id], [early, p.id], [done, d.o.id], [gone, c.id]] as const) expect((await x.orders.get(id)).returnFareIqd).toBeUndefined();
  });

  it('the refusal skip moves no order and is no listener’s skip/no-show (notify, dispatch, orders ignore it)', async () => {
    expect(NOTIFY_EVENT_TYPES as readonly string[]).not.toContain('stop.skipped');
    expect(DISPATCH_TRIP_EVENTS as readonly string[]).not.toContain('stop.skipped');
    const h = ordersHarness();
    const { o } = await atTheDoor(h);
    const before = h.events.types(o.id).length;
    await h.orders.returnParcel('d1', o.id);
    await h.deliver();
    expect(h.tripEvents.ofType('stop.skipped').map((e) => e.payload['reason'])).toEqual(['parcel_refused']);
    // Only the order's own «returning» fact: no cancellation, dispute, failure or penalty.
    expect(h.events.types(o.id).slice(before)).toEqual(['order.parcel_returning']);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
  });
});

describe('the hand-back: one parcel fee for both trips, from the sender', () => {
  /** Orders + the ledger; `post()` runs the ledger's subscribers on what orders emitted (rides post on cash collected too). */
  const make = () => {
    const lh = ledgerHarness();
    const h = staffHarness({}, { ledger: lh });
    let seen = 0;
    const post = async () => {
      for (const e of h.events.events.slice(seen)) {
        if (e.type !== 'order.cash_collected') continue;
        const p = decodeDomainEvent('order.cash_collected', e.payload);
        if (p.kind === 'ride') await lh.posting.rideMoney(p.ride);
      }
      seen = h.events.events.length;
      await h.settle();
    };
    return Object.assign(h, { post });
  };

  it('full cash at the sender’s door: one parcel_fee = out + back from customer:<sender> to the courier, 15 % take', async () => {
    const h = make();
    const { o, t } = await atTheDoor(h, 'c1');
    await h.orders.returnParcel('d1', o.id);
    const total = (await h.orders.get(o.id)).totalIqd;
    await handBack(h, t.id, total);
    expect((await h.orders.get(o.id)).state).toBe('delivered');
    expect((await h.trips.get(t.id)).state).toBe('completed');
    await h.advance(ORDERS_RULES.autoCloseMs + 1_000);
    await h.post();

    const lines = await h.ledger.eventsForOrder(o.id);
    const fees = lines.filter((l) => l.type === 'parcel_fee');
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ amount: total, fromAccount: 'customer:c1', toAccount: 'driver:d1' });
    const take = lines.filter((l) => l.type === 'commission_accrued').reduce((a, l) => a + l.amount, 0);
    expect(take).toBe(takeOf(total, AZIZIYAH_MONEY_RULES.take.parcel));
    expect(AZIZIYAH_MONEY_RULES.take.parcel).toMatchObject({ rate: 0.15 });
    // Paid in full: the sender's wallet is square, and no customer account but the sender's is touched.
    expect(await h.balance('customer:c1')).toBe(0);
    const customers = new Set(lines.flatMap((l) => [l.fromAccount, l.toAccount]).filter((a) => a.startsWith('customer:')));
    expect([...customers]).toEqual(['customer:c1']);
  });

  it('no cash at the hand-back: the sender owes it, and his next cash food order collects it', async () => {
    const h = make();
    (h.cashRisk as OrdersCashRiskPort).debtToCollect = (c) => h.cashLimits.debtToCollect(c);
    const { o, t } = await atTheDoor(h, 'c1');
    await h.orders.returnParcel('d1', o.id);
    const total = (await h.orders.get(o.id)).totalIqd;
    await handBack(h, t.id, 0);
    await h.advance(ORDERS_RULES.autoCloseMs + 1_000);
    await h.post();
    const owed = -(await h.balance('customer:c1'));
    expect(owed).toBe(total);
    const quote = await h.orders.quote('c1', h.foodInput());
    expect(quote.debtCollectIqd).toBe(total);
  });
});
