import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, type OrderMoneyPayload } from '@driver/contracts';
import { Accounts } from '../ledger/accounts.js';
import { postOrderClosed } from '../ledger/postings.js';
import { ORDERS_RULES } from './orders.config.js';
import { HOME, ordersHarness } from './test-harness.js';

/**
 * J-D6 (Ali, 2026-10-05): an order below the restaurant's minimum is not refused; it carries the
 * city's small-order fee (500 دينار), computed on the server, stored with the order, part of its
 * total and booked by the ledger as platform revenue (`service_fee`, memo `small_order`).
 */

/** rest_1's storefront: open all Saturday, minimum 12,000 on the items. */
async function withMinimum(h: ReturnType<typeof ordersHarness>, minOrderIqd = 12_000) {
  await h.catalog.saveStorefront({ orgId: 'rest_1', cityId: 'aziziyah', nameAr: 'مطعم خالد', cuisineAr: 'مشويات', minOrderIqd, hours: [{ dow: 6, start: '00:00', end: '23:59' }] });
}

/** 2 × kebab = 10,000: 2,000 under the 12,000 minimum. */
const SMALL = [{ catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000 }];

describe('small-order fee (J-D6)', () => {
  it('is a named config value: the city money rule, 500', () => {
    expect(ORDERS_RULES.smallOrder.feeIqd).toBe(AZIZIYAH_MONEY_RULES.smallOrder.feeIqd);
    expect(ORDERS_RULES.smallOrder.feeIqd).toBe(500);
  });

  it('orders.quote: a basket under the minimum shows the fee, its reason and a total that includes it', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    const q = await h.orders.quote('c1', h.foodInput({ lines: SMALL }));
    expect(q).toMatchObject({ itemsTotalIqd: 10_000, deliveryFeeIqd: 1_000, serviceFeeIqd: 500, smallOrderFeeIqd: 500, smallOrder: { minOrderIqd: 12_000, feeIqd: 500 } });
    expect(q.totalIqd).toBe(12_000);
    // At the minimum: no fee, the minimum is still reported for the cart's progress strip.
    const full = await h.orders.quote('c1', h.foodInput());
    expect(full).toMatchObject({ itemsTotalIqd: 15_000, smallOrderFeeIqd: 0, smallOrder: { minOrderIqd: 12_000, feeIqd: 500 }, totalIqd: 16_500 });
  });

  it('a restaurant without a minimum never charges it', async () => {
    const h = ordersHarness();
    await withMinimum(h, 0);
    const q = await h.orders.quote('c1', h.foodInput({ lines: [{ catalogItemId: 'x', qty: 1, unitPriceIqd: 1000 }] }));
    expect(q).toMatchObject({ smallOrderFeeIqd: 0, smallOrder: null, totalIqd: 2_500 });
  });

  it('orders.place: goes ahead below the minimum and stores the fee with the order', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    const o = await h.orders.place('c1', h.foodInput({ lines: SMALL }));
    expect(o).toMatchObject({ state: 'placed', itemsTotalIqd: 10_000, smallOrderFeeIqd: 500, totalIqd: 12_000 });
    expect((await h.orders.get(o.id)).smallOrderFeeIqd).toBe(500);
    // A scheduled order below the minimum goes ahead the same way.
    const later = await h.orders.place('c1', h.foodInput({ lines: SMALL, scheduledFor: new Date(h.clock.now().getTime() + 2 * 60 * 60_000) }));
    expect(later).toMatchObject({ smallOrderFeeIqd: 500, totalIqd: 12_000 });
  });

  it('free-text requests (priced 0) do not lift a basket over the minimum', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    const o = await h.orders.place('c1', h.foodInput({ lines: [...SMALL, { freeText: 'خبز زيادة', qty: 5 }] }));
    expect(o.smallOrderFeeIqd).toBe(500);
  });

  it('the minimum is on the items before a deal: a deal that takes a basket below it adds no fee', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    await h.promotions.addDeal({ type: 'percent', value: 20, minOrderIqd: 0 });
    const q = await h.orders.quote('c1', h.foodInput());
    expect(q).toMatchObject({ itemsTotalIqd: 15_000, discountIqd: 3_000, smallOrderFeeIqd: 0, totalIqd: 13_500 });
  });

  it('a wallet order pays the exact price with the fee', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    h.wallets.set('customer:c1', 50_000);
    const o = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'falafel', qty: 1, unitPriceIqd: 1500 }], paymentMethod: 'wallet' }));
    expect(o).toMatchObject({ itemsTotalIqd: 1_500, smallOrderFeeIqd: 500, totalIqd: 3_500 });
  });

  it('the ledger books the fee as platform revenue and the customer pays the order total', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    const o = await h.orders.place('c1', h.foodInput({ lines: SMALL }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    await h.dropoff(t.id, { cashCollectedIqd: 12_000 });
    await h.advance(2 * 60 * 60_000);
    const fact = h.events.last('order.closed')!.payload['order'] as OrderMoneyPayload;
    expect(fact).toMatchObject({ itemsSubtotalIqd: 10_000, smallOrderFeeIqd: 500 });
    const posted = postOrderClosed(fact, AZIZIYAH_MONEY_RULES);
    expect(posted.totalIqd).toBe(12_000);
    expect(posted.money.lines.find((l) => l.memo === 'small_order')).toMatchObject({ type: 'service_fee', amount: 500, toAccount: Accounts.platform });
    expect(posted.money.lines.some((l) => l.type === 'cash_rounding_credit')).toBe(false);
  });

  it('a partial accept keeps the fee as placed', async () => {
    const h = ordersHarness();
    await withMinimum(h);
    const o = await h.orders.place('c1', h.foodInput({ lines: [...SMALL, { catalogItemId: 'x', qty: 1, unitPriceIqd: 1000 }] }));
    expect(o).toMatchObject({ itemsTotalIqd: 11_000, smallOrderFeeIqd: 500, totalIqd: 13_000 });
    const xLine = o.lines.find((l) => l.catalogItemId === 'x')!;
    const proposed = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: [xLine.id] });
    expect(proposed.partial?.reducedTotalIqd).toBe(12_000);
    const approved = await h.orders.respondPartial('c1', { orderId: o.id, approve: true });
    expect(approved).toMatchObject({ itemsTotalIqd: 10_000, smallOrderFeeIqd: 500, totalIqd: 12_000 });
  });
});
