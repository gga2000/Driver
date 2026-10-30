import { describe, expect, it } from 'vitest';
import { DriverError, RATING_RULES, courierReasonsFor, publicCourierRating } from '@driver/contracts';
import { ordersHarness } from './test-harness.js';

/**
 * Rate the courier (before-launch §6; customer app §4 two-tap rating, step 1): the delivery score is
 * the courier's own rating — one row per order for the driver who carried it, only by the order's
 * customer, within 24 h of delivery, with one-tap reasons under a low score.
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

async function delivered(h: H, opts: { customer?: string; driverId?: string } = {}) {
  const customer = opts.customer ?? 'c1';
  const o = await h.orders.place(customer, h.foodInput());
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  const t = await h.tripFor(o.id, opts.driverId ? { driverId: opts.driverId } : {});
  await h.pickup(t.id, opts.driverId);
  await h.dropoff(t.id, { cashCollectedIqd: (await h.orders.get(o.id)).totalIqd, ...(opts.driverId ? { driverId: opts.driverId } : {}) });
  return { o, t };
}

describe('rate the courier', () => {
  it('stores the delivery score as the carrier’s own rating, with his reasons, once per order', async () => {
    const h = ordersHarness();
    const { o, t } = await delivered(h);
    await h.orders.rate('c1', { orderId: o.id, delivery: 2, food: 5, courierReasons: ['late', 'rude'] });
    expect(await h.repo.courierRatingOf(o.id)).toMatchObject({ orderId: o.id, tripId: t.id, driverId: 'd1', customerId: 'c1', score: 2, reasons: ['late', 'rude'] });
    expect((await h.orders.get(o.id)).rating).toMatchObject({ delivery: 2, food: 5, courierReasons: ['late', 'rude'] });
    // The first rating stands: a second one changes nothing and adds no row.
    await h.orders.rate('c1', { orderId: o.id, delivery: 5 });
    expect((await h.repo.courierRatingsOf('d1', 10)).map((r) => r.score)).toEqual([2]);
  });

  it('a second row for the same order is not written (the double tap that lost the race reads the first)', async () => {
    const h = ordersHarness();
    const { o, t } = await delivered(h);
    await h.orders.rate('c1', { orderId: o.id, delivery: 4 });
    const late = { orderId: o.id, tripId: t.id, driverId: 'd1', customerId: 'c1', score: 1, reasons: [], ratedAt: h.clock.now() };
    expect(await h.repo.addCourierRating(late)).toBeNull();
    expect((await h.repo.courierRatingsOf('d1', 10)).map((r) => r.score)).toEqual([4]);
  });

  it('only the order’s customer may rate', async () => {
    const h = ordersHarness();
    const { o } = await delivered(h);
    expect(await code(h.orders.rate('c2', { orderId: o.id, delivery: 1 }))).toBe('forbidden');
    expect(await code(h.orders.rate('d1', { orderId: o.id, delivery: 5 }))).toBe('forbidden');
    expect(await h.repo.courierRatingOf(o.id)).toBeNull();
  });

  it(`is taken within ${RATING_RULES.windowHours} h of delivery, then refused`, async () => {
    const h = ordersHarness();
    const { o } = await delivered(h);
    h.clock.advance(RATING_RULES.windowHours * 3_600_000 + 60_000);
    expect(await code(h.orders.rate('c1', { orderId: o.id, delivery: 4, food: 4 }))).toBe('rating_window_closed');
    expect(await h.repo.courierRatingOf(o.id)).toBeNull();
    // The plain "close early" call (no scores) is not a rating and still works.
    expect(await code(h.orders.rate('c1', { orderId: o.id }))).toBe('ok');

    const h2 = ordersHarness();
    const second = await delivered(h2);
    h2.clock.advance(RATING_RULES.windowHours * 3_600_000 - 60_000);
    expect(await code(h2.orders.rate('c1', { orderId: second.o.id, delivery: 4 }))).toBe('ok');
  });

  it('takes only the reasons offered under the score, and only with a courier score', async () => {
    const h = ordersHarness();
    const { o } = await delivered(h);
    // A good score with a reason (kind words are compliments), a ride-only reason on a delivery, reasons without a score.
    expect(await code(h.orders.rate('c1', { orderId: o.id, delivery: 5, courierReasons: ['rude'] }))).toBe('invalid_input');
    expect(await code(h.orders.rate('c1', { orderId: o.id, delivery: 2, courierReasons: ['unsafe_driving'] }))).toBe('invalid_input');
    expect(await code(h.orders.rate('c1', { orderId: o.id, food: 2, courierReasons: ['late'] }))).toBe('invalid_input');
    expect(await code(h.orders.rate('c1', { orderId: o.id, delivery: 2, courierReasons: ['late', 'mishandled'] }))).toBe('ok');
    expect(courierReasonsFor(5, false)).toEqual([]);
    expect(courierReasonsFor(3, false)).toEqual(['late', 'rude', 'mishandled', 'hard_to_reach']);
    expect(courierReasonsFor(2, true)).toEqual(['late', 'rude', 'hard_to_reach', 'unsafe_driving']);
  });

  it('a food score alone (the courier skipped) records no courier rating', async () => {
    const h = ordersHarness();
    const { o } = await delivered(h);
    await h.orders.rate('c1', { orderId: o.id, food: 3 });
    expect(await h.repo.courierRatingOf(o.id)).toBeNull();
  });

  it('his ratings are his own, newest first (the scorecard and the card read them)', async () => {
    const h = ordersHarness();
    const scores = [5, 4, 5, 3];
    for (const [i, s] of scores.entries()) {
      const { o } = await delivered(h, { customer: `c${i + 1}` });
      await h.orders.rate(`c${i + 1}`, { orderId: o.id, delivery: s });
    }
    const fifth = await delivered(h, { customer: 'c9' });
    await h.orders.rate('c9', { orderId: fifth.o.id, delivery: 4 });
    // Another driver's rating is his own.
    const other = await delivered(h, { customer: 'c10', driverId: 'd2' });
    await h.orders.rate('c10', { orderId: other.o.id, delivery: 1 });
    const mine = await h.orders.courierRatings('d1');
    expect(mine.map((r) => r.score).sort()).toEqual([3, 4, 4, 5, 5]);
    expect(publicCourierRating(mine)).toEqual({ rating: 4.2, count: 5 });
    expect((await h.orders.courierRatings('d2')).map((r) => r.score)).toEqual([1]);
  });
});
