import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, latePromiseCreditIqd, latePromiseTerms, type Actor } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { Accounts } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { ordersHarness } from '../orders/test-harness.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { eventsLateApology, LATE_APOLOGY_EVENT, latePromiseGroupId, ledgerLateCredit } from './late-promise.js';
import { lateApologyDue, TrackingService } from './tracking.service.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const MIN = 60_000;
const AFTER = AZIZIYAH_MONEY_RULES.latePromise.afterMin;
const APOLOGY = AZIZIYAH_MONEY_RULES.latePromise.apologyAfterMin;
const FREE_DELIVERY_CREDIT = AZIZIYAH_MONEY_RULES.latePromise.freeDeliveryCreditIqd;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

function setup() {
  const h = ordersHarness();
  const l = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
  const credit = ledgerLateCredit(l.ledger);
  const ev = createInMemoryEvents({ clock: h.clock });
  const tracking = new TrackingService(
    h.orders,
    h.trips,
    { courierCard: async () => ({ firstName: 'حيدر', lastVerifiedAt: null }) },
    { merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null), itemNames: async () => new Map() },
    { earnedOn: async () => 0 },
    new InMemoryCourierVehicles(),
    h.clock,
    new EtaService(new StraightLineRouter()),
    credit,
    eventsLateApology(ev.events),
  );
  const wallet = async (personId: string) => (await l.ledger.balance(Accounts.customer(personId))).amount;
  const apologies = async (orderId: string) => (await ev.events.forOrder(orderId)).filter((e) => e.type === LATE_APOLOGY_EVENT);
  return { h, l, tracking, wallet, apologies };
}

async function onTheWay(h: ReturnType<typeof ordersHarness>) {
  const placed = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
  const trip = await h.tripFor(placed.id);
  await h.pickup(trip.id);
  return { orderId: placed.id, tripId: trip.id };
}

describe('latePromiseCreditIqd', () => {
  it('gives back the delivery fee the customer pays, unchanged when there is one', () => {
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1000 })).toBe(1000);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 500 })).toBe(500);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1500, discount: { target: 'items', amountIqd: 3000 } })).toBe(1500);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1500, discount: { target: 'delivery', amountIqd: 500 } })).toBe(1000);
    expect(latePromiseTerms({ deliveryFeeIqd: 1500 })).toEqual({ creditIqd: 1500, basis: 'delivery_fee' });
  });

  it('a free-delivery order (fee 0 after deals) gets the fixed 1,000 instead of no promise (Ali, 2026-10-06)', () => {
    expect(FREE_DELIVERY_CREDIT).toBe(1000);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1500, discount: { target: 'delivery', amountIqd: 1500 } })).toBe(1000);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 0 })).toBe(1000);
    expect(latePromiseTerms({ deliveryFeeIqd: 0 })).toEqual({ creditIqd: 1000, basis: 'flat' });
    // Turned off in config: back to no promise without a fee.
    expect(latePromiseTerms({ deliveryFeeIqd: 0 }, { ...AZIZIYAH_MONEY_RULES.latePromise, freeDeliveryCreditIqd: 0 })).toBeNull();
  });
});

describe('lateApologyDue', () => {
  const promisedAt = new Date('2026-10-03T10:00:00Z');
  const at = (min: number) => new Date(promisedAt.getTime() + min * MIN);
  const live = { state: 'picked_up' as const, deliveredAt: null };
  it('is due from the promised time + apologyAfterMin, on the way only', () => {
    expect(APOLOGY).toBe(10);
    expect(lateApologyDue(live, promisedAt, at(APOLOGY - 1), false)).toBe(false);
    expect(lateApologyDue(live, promisedAt, at(APOLOGY), false)).toBe(true);
    expect(lateApologyDue({ state: 'delivered', deliveredAt: at(5) }, promisedAt, at(APOLOGY + 1), false)).toBe(false);
    expect(lateApologyDue({ state: 'customer_cancelled', deliveredAt: null }, promisedAt, at(APOLOGY + 1), false)).toBe(false);
    expect(lateApologyDue({ state: 'platform_cancelled', deliveredAt: null }, promisedAt, at(APOLOGY + 1), false)).toBe(false);
    expect(lateApologyDue(live, promisedAt, at(APOLOGY + 1), true)).toBe(false);
  });
});

describe('honest-delay promise (audit d-5)', () => {
  it('shows the terms with the deadline, and no credit while we are inside it', async () => {
    const { h, tracking, wallet } = setup();
    const { orderId } = await onTheWay(h);
    const v = await tracking.track(as('c1'), { orderId });
    expect(v.latePromise).toMatchObject({ afterMin: AFTER, creditIqd: 1000, basis: 'delivery_fee', credit: null, apologyAfterMin: APOLOGY, apology: null });
    expect(v.latePromise!.deadlineAt.getTime()).toBe(v.promisedAt!.getTime() + AFTER * MIN);
    expect(await wallet('c1')).toBe(0);
  });

  it('past the deadline the delivery fee comes back as wallet credit, once', async () => {
    const { h, l, tracking, wallet } = setup();
    const { orderId } = await onTheWay(h);
    const { promisedAt } = await tracking.track(as('c1'), { orderId });
    h.clock.advance(promisedAt!.getTime() + (AFTER + 1) * MIN - h.clock.now().getTime());
    const v = await tracking.track(as('c1'), { orderId });
    expect(v.latePromise!.credit).toMatchObject({ amountIqd: 1000 });
    await tracking.track(as('c1'), { orderId });
    expect(await wallet('c1')).toBe(1000);
    const lines = (await l.ledger.eventsForOrder(orderId)).filter((e) => e.postingGroupId === latePromiseGroupId(orderId));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'credit_issued', fromAccount: Accounts.platform, toAccount: Accounts.customer('c1'), amount: 1000 });
  });

  it('a delivery past the deadline gets the credit at delivery even if nobody was watching', async () => {
    const { h, tracking, wallet } = setup();
    const { orderId, tripId } = await onTheWay(h);
    const { promisedAt } = await tracking.track(as('c1'), { orderId });
    h.clock.advance(promisedAt!.getTime() + (AFTER + 5) * MIN - h.clock.now().getTime());
    await h.dropoff(tripId, { cashCollectedIqd: 16500 });
    await tracking.settleLatePromise(orderId);
    expect(await wallet('c1')).toBe(1000);
  });

  it('on time, or cancelled before the deadline: no credit', async () => {
    const { h, tracking, wallet } = setup();
    // Delivered inside the promise: nothing, even if read much later.
    const a = await onTheWay(h);
    await h.dropoff(a.tripId, { cashCollectedIqd: 16500 });
    h.clock.advance(3 * 60 * MIN);
    await tracking.settleLatePromise(a.orderId);
    expect((await tracking.track(as('c1'), { orderId: a.orderId })).latePromise!.credit).toBeNull();
    // Cancelled before anything was late: the clock passing the deadline later changes nothing.
    const placed = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    await h.orders.cancel('c1', { orderId: placed.id, reason: 'تغيّر رأيي' });
    h.clock.advance(3 * 60 * MIN);
    const cancelled = await tracking.track(as('c1'), { orderId: placed.id });
    expect(cancelled.latePromise?.credit ?? null).toBeNull();
    expect(await wallet('c1')).toBe(0);
  });

  it('a free-delivery order carries the promise too: 1,000 back past the deadline, platform-funded, once', async () => {
    const { h, l, tracking, wallet } = setup();
    await h.promotions.addDeal({ type: 'free_delivery', minOrderIqd: 15000 });
    const quote = await h.orders.quote('c1', h.foodInput());
    expect(quote.latePromise).toEqual({ afterMin: AFTER, creditIqd: FREE_DELIVERY_CREDIT, basis: 'flat' });
    const placed = await h.orders.place('c1', h.foodInput({ discountIqd: 1000 }));
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    const trip = await h.tripFor(placed.id);
    await h.pickup(trip.id);
    const v = await tracking.track(as('c1'), { orderId: placed.id });
    expect(v.latePromise).toMatchObject({ creditIqd: FREE_DELIVERY_CREDIT, basis: 'flat', credit: null });
    h.clock.advance(v.promisedAt!.getTime() + (AFTER + 1) * MIN - h.clock.now().getTime());
    expect((await tracking.track(as('c1'), { orderId: placed.id })).latePromise!.credit).toMatchObject({ amountIqd: FREE_DELIVERY_CREDIT });
    await tracking.track(as('c1'), { orderId: placed.id });
    expect(await wallet('c1')).toBe(FREE_DELIVERY_CREDIT);
    const lines = (await l.ledger.eventsForOrder(placed.id)).filter((e) => e.postingGroupId === latePromiseGroupId(placed.id));
    expect(lines).toEqual([expect.objectContaining({ type: 'credit_issued', fromAccount: Accounts.platform, toAccount: Accounts.customer('c1'), amount: FREE_DELIVERY_CREDIT })]);
  });
});

describe('honest-delay apology (step one, Ali 2026-10-06)', () => {
  it('fires once at the promised time + 10 min with the new time, watched or not, and posts no money', async () => {
    const { h, tracking, wallet, apologies } = setup();
    const { orderId } = await onTheWay(h);
    const { promisedAt } = await tracking.track(as('c1'), { orderId });
    h.clock.advance(promisedAt!.getTime() + APOLOGY * MIN - 1000 - h.clock.now().getTime());
    expect(await tracking.sweepLateApologies()).toBe(0);
    expect((await tracking.track(as('c1'), { orderId })).latePromise!.apology).toBeNull();
    h.clock.advance(1000);
    expect(await tracking.sweepLateApologies()).toBe(1);
    expect(await tracking.sweepLateApologies()).toBe(0);
    const v = await tracking.track(as('c1'), { orderId });
    expect(v.latePromise!.apology).toMatchObject({ at: h.clock.now() });
    expect(v.latePromise!.apology!.etaAt.getTime()).toBeGreaterThan(h.clock.now().getTime());
    expect(v.latePromise!.credit).toBeNull();
    // Later reads and sweeps (even past the credit) never send a second one.
    h.clock.advance(15 * MIN);
    await tracking.track(as('c1'), { orderId });
    expect(await tracking.sweepLateApologies()).toBe(0);
    const sent = await apologies(orderId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ customerId: 'c1', promisedAt: promisedAt!.toISOString() });
    expect(await wallet('c1')).toBe(1000); // the step-two credit, not the apology
  });

  it('a customer watching the screen gets it from the read; the sweep then sends nothing', async () => {
    const { h, tracking, apologies } = setup();
    const { orderId } = await onTheWay(h);
    const { promisedAt } = await tracking.track(as('c1'), { orderId });
    h.clock.advance(promisedAt!.getTime() + (APOLOGY + 1) * MIN - h.clock.now().getTime());
    expect((await tracking.track(as('c1'), { orderId })).latePromise!.apology).not.toBeNull();
    expect(await tracking.sweepLateApologies()).toBe(0);
    expect(await apologies(orderId)).toHaveLength(1);
  });

  it('no apology for an order delivered, cancelled, or whose customer is not answering', async () => {
    const { h, tracking, apologies } = setup();
    // Delivered on time.
    const a = await onTheWay(h);
    await h.dropoff(a.tripId, { cashCollectedIqd: 16500 });
    // Cancelled before it was late.
    const placed = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    await h.orders.cancel('c1', { orderId: placed.id, reason: 'تغيّر رأيي' });
    // At the door, the customer not answering.
    const c = await onTheWay(h);
    const drop = (await h.trips.get(c.tripId)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(c.tripId, drop.id, 'd1', { pin: { lat: 32.92, lng: 45.07 } });
    await h.trips.startUnreachable(c.tripId, drop.id, 'd1');
    expect((await h.trips.get(c.tripId)).unreachable).not.toBeNull();
    h.clock.advance(3 * 60 * MIN);
    expect(await tracking.sweepLateApologies()).toBe(0);
    for (const orderId of [a.orderId, placed.id, c.orderId]) {
      expect((await tracking.track(as('c1'), { orderId })).latePromise?.apology ?? null).toBeNull();
      expect(await apologies(orderId)).toHaveLength(0);
    }
  });
});
