import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, latePromiseCreditIqd, type Actor } from '@driver/contracts';
import { Accounts } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { ordersHarness } from '../orders/test-harness.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { latePromiseGroupId, ledgerLateCredit } from './late-promise.js';
import { TrackingService } from './tracking.service.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const MIN = 60_000;
const AFTER = AZIZIYAH_MONEY_RULES.latePromise.afterMin;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

function setup() {
  const h = ordersHarness();
  const l = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
  const credit = ledgerLateCredit(l.ledger);
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
  );
  const wallet = async (personId: string) => (await l.ledger.balance(Accounts.customer(personId))).amount;
  return { h, l, tracking, wallet };
}

async function onTheWay(h: ReturnType<typeof ordersHarness>) {
  const placed = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
  const trip = await h.tripFor(placed.id);
  await h.pickup(trip.id);
  return { orderId: placed.id, tripId: trip.id };
}

describe('latePromiseCreditIqd', () => {
  it('gives back the delivery fee the customer pays; a free-delivery deal leaves nothing to promise', () => {
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1000 })).toBe(1000);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1500, discount: { target: 'items', amountIqd: 3000 } })).toBe(1500);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 1500, discount: { target: 'delivery', amountIqd: 1500 } })).toBe(0);
    expect(latePromiseCreditIqd({ deliveryFeeIqd: 0 })).toBe(0);
  });
});

describe('honest-delay promise (audit d-5)', () => {
  it('shows the terms with the deadline, and no credit while we are inside it', async () => {
    const { h, tracking, wallet } = setup();
    const { orderId } = await onTheWay(h);
    const v = await tracking.track(as('c1'), { orderId });
    expect(v.latePromise).toMatchObject({ afterMin: AFTER, creditIqd: 1000, credit: null });
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
});
