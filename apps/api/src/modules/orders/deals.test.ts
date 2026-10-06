import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, type MerchantPayableAccruedPayload, type OrderMoneyPayload } from '@driver/contracts';
import { Accounts } from '../ledger/accounts.js';
import { postOrderClosed } from '../ledger/postings.js';
import { OrdersStorefrontMerchants } from './storefront.port.js';
import { ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** Net per account of a posting group (claims view: + owed to / earned by the holder). */
function nets(lines: ReadonlyArray<{ amount: number; fromAccount: string; toAccount: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    m.set(l.toAccount, (m.get(l.toAccount) ?? 0) + l.amount);
    m.set(l.fromAccount, (m.get(l.fromAccount) ?? 0) - l.amount);
  }
  return m;
}

/** Places, accepts, carries and delivers a cash order; returns the money fact the ledger posts. */
async function deliverCash(h: ReturnType<typeof ordersHarness>, orderId: string, totalIqd: number) {
  await h.orders.merchantAccept('m1', { orderId, prepMinutes: 15 });
  const t = await h.tripFor(orderId);
  await h.pickup(t.id);
  await h.dropoff(t.id, { cashCollectedIqd: totalIqd });
  return {
    fact: h.events.last('order.cash_collected')!.payload['order'] as OrderMoneyPayload,
    payable: h.events.last('merchant.payable_accrued')!.payload as unknown as MerchantPayableAccruedPayload,
  };
}

describe('merchant deals at checkout (domain §11, G-87)', () => {
  it('percent off: the quote shows the line and the exact savings; place locks the same numbers', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 15 });
    const q = await h.orders.quote('c1', h.foodInput());
    // 15 % of 15,000 = 2,250 exactly (Ali, 2026-10-04: the deal is never trimmed); 16,500 − 2,250 = 14,250.
    expect(q).toMatchObject({ itemsTotalIqd: 15000, deliveryFeeIqd: 1000, serviceFeeIqd: 500, discountIqd: 2250, totalIqd: 14250, changeIqd: 0, lineSavingsIqd: [1500, 750], roundingIqd: 0, nextDeal: null });
    expect(q.discount).toMatchObject({ promotionId: d.id, funder: 'merchant', target: 'items', type: 'percent', label_ar: 'خصم 15% على كل المنيو', amountIqd: 2250, dealIqd: 2250, roundingIqd: 0 });
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd }));
    expect(o).toMatchObject({ discountIqd: 2250, totalIqd: 14250, changeIqd: 0, discount: { funder: 'merchant', target: 'items', amountIqd: 2250 } });
    expect(await h.promotions.spent(d.id)).toBe(2250);
    expect(h.events.last('order.placed')!.payload).toMatchObject({ discountIqd: 2250, promotionId: d.id, discountFunder: 'merchant' });
  });

  it('cash rounding (Ali, 2026-10-04): the total rounds up to 250 and the change goes to the wallet; the merchant pays exactly the deal', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'percent', value: 7 });
    const q = await h.orders.quote('c1', h.foodInput());
    // 7 % of 10,000 + 5,000 = 700 + 350 = 1,050 → price 15,450 → hands over 15,500, 50 back as wallet credit.
    expect(q).toMatchObject({ discountIqd: 1050, totalIqd: 15500, changeIqd: 50, dealLineSavingsIqd: [700, 350], lineSavingsIqd: [700, 350], roundingIqd: 0 });
    expect(q.discount).toMatchObject({ amountIqd: 1050, dealIqd: 1050, roundingIqd: 0 });
    // items − deal + fees + change = what he hands over; no line raises the price.
    expect(q.itemsTotalIqd - q.discountIqd + q.deliveryFeeIqd + q.serviceFeeIqd + q.changeIqd!).toBe(q.totalIqd);
    // A wallet payment pays the exact price.
    expect(await h.orders.quote('c1', h.foodInput({ paymentMethod: 'wallet' }))).toMatchObject({ totalIqd: 15450, changeIqd: 0 });
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd }));
    expect(o).toMatchObject({ totalIqd: 15500, changeIqd: 50, discountIqd: 1050 });
    const { fact } = await deliverCash(h, o.id, o.totalIqd);
    expect(fact.merchantDeal).toMatchObject({ amountIqd: 1050 });
    const posted = postOrderClosed(fact, AZIZIYAH_MONEY_RULES);
    const n = nets(posted.money.lines);
    expect(posted.totalIqd).toBe(15500);
    expect(n.get(Accounts.customer('c1'))).toBe(50); // "الباقي رصيد"
    expect(posted.money.lines.filter((l) => l.type === 'promo_funded').map((l) => l.amount)).toEqual([1050]);
    expect(posted.money.lines.find((l) => l.type === 'cash_rounding_credit')).toMatchObject({ amount: 50, memo: 'change_as_credit' });
  });

  it('cash rounding edge cases: exact multiples, tips and partial accepts keep the 250 rule', async () => {
    const h = ordersHarness();
    // No deal: 16,500 is already on the step. The late promise gives back the 1,000 delivery fee (audit d-5).
    expect(await h.orders.quote('c1', h.foodInput())).toMatchObject({ totalIqd: 16500, changeIqd: 0, latePromise: { afterMin: AZIZIYAH_MONEY_RULES.latePromise.afterMin, creditIqd: 1000 } });
    // A 100 tip makes 16,600 → 16,750 handed over, 150 back.
    expect(await h.orders.quote('c1', h.foodInput({ tipIqd: 100 }))).toMatchObject({ totalIqd: 16750, changeIqd: 150 });
    // Partial accept with a 7 % deal: the reduced total is the reduced price rounded up the same way.
    await h.promotions.addDeal({ type: 'percent', value: 7 });
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: 1050 }));
    const tikka = o.lines.find((l) => l.catalogItemId === 'tikka')!;
    const proposed = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: [tikka.id] });
    // 10,000 − 700 + 1,500 = 10,800 → 11,000 (200 change).
    expect(proposed.partial).toMatchObject({ reducedItemsTotalIqd: 10000, reducedTotalIqd: 11000 });
    const approved = await h.orders.respondPartial('c1', { orderId: o.id, approve: true });
    expect(approved).toMatchObject({ totalIqd: 11000, changeIqd: 200, discountIqd: 700 });
  });

  it('wallet at checkout (C-04): the order must be covered by the balance left after open wallet orders', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet' })))).toBe('wallet_insufficient');
    h.wallets.set('customer:c1', 20000);
    const first = await h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet' }));
    expect(first).toMatchObject({ paymentMethod: 'wallet', totalIqd: 16500, changeIqd: 0 });
    // 20,000 − 16,500 open = 3,500 left: a second one is refused until the first closes.
    expect(await code(h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet' })))).toBe('wallet_insufficient');
    // Cash is never checked against the wallet.
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
  });

  it('presentation: a deal applies exactly, so there is never a rounding line', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'percent', value: 20 });
    const q = await h.orders.quote('c1', h.foodInput());
    expect(q).toMatchObject({ discountIqd: 3000, dealLineSavingsIqd: [2000, 1000], lineSavingsIqd: [2000, 1000], roundingIqd: 0, discount: { dealIqd: 3000, roundingIqd: 0 } });
  });

  it('money: an items deal lowers the commission base; the merchant funds it; courier and platform fee unchanged', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 20 });
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: 3000 }));
    expect(o.totalIqd).toBe(13500);
    const { fact, payable } = await deliverCash(h, o.id, o.totalIqd);
    expect(fact).toMatchObject({ itemsSubtotalIqd: 15000, merchantDeal: { promotionId: d.id, target: 'items', amountIqd: 3000 } });
    expect(fact.platformPromo).toBeUndefined();
    const rules = AZIZIYAH_MONEY_RULES;
    const posted = postOrderClosed(fact, rules);
    const n = nets(posted.money.lines);
    const rate = rules.commission[fact.commissionTier];
    const commission = Math.round(12000 * rate);
    expect(posted.totalIqd).toBe(13500);
    expect(n.get(Accounts.merchantCash('rest_1'))).toBe(15000 - 3000 - commission);
    expect(n.get(Accounts.platform)).toBe(500 + commission);
    expect(n.get(Accounts.driver('d1'))).toBe(1000);
    expect(posted.money.lines).toContainEqual(expect.objectContaining({ type: 'promo_funded', amount: 3000, fromAccount: Accounts.merchantCash('rest_1'), memo: `deal:${d.id}` }));
    // Nothing goes to rounding: the total was already on the step.
    expect(posted.money.lines.some((l) => l.type === 'rounding_residue')).toBe(false);
    expect(payable).toMatchObject({ grossIqd: 15000, commissionIqd: commission, dealIqd: 3000, netIqd: 15000 - commission - 3000 });
  });

  it('free delivery: the merchant pays the fee, the courier still earns all of it, commission on full items', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'free_delivery', minOrderIqd: 15000 });
    const q = await h.orders.quote('c1', h.foodInput());
    expect(q).toMatchObject({ discountIqd: 1000, totalIqd: 15500, lineSavingsIqd: [0, 0], discount: { target: 'delivery', label_ar: 'توصيل مجاني فوق 15,000 دينار' } });
    // Audit d-5: nothing to give back when delivery is free, so checkout makes no late promise.
    expect(q.latePromise).toBeNull();
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: 1000 }));
    const { fact } = await deliverCash(h, o.id, o.totalIqd);
    const posted = postOrderClosed(fact, AZIZIYAH_MONEY_RULES);
    const n = nets(posted.money.lines);
    const commission = Math.round(15000 * AZIZIYAH_MONEY_RULES.commission[fact.commissionTier]);
    expect(n.get(Accounts.driver('d1'))).toBe(1000);
    expect(n.get(Accounts.merchantCash('rest_1'))).toBe(15000 - commission - 1000);
    expect(posted.money.lines).toContainEqual(expect.objectContaining({ type: 'promo_funded', amount: 1000, memo: `deal:${d.id}:delivery` }));
    expect(posted.totalIqd).toBe(15500);
  });

  it('BOGO and fixed-off-selected-items value free units at menu price', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'bogo', itemIds: ['kebab'] });
    const q = await h.orders.quote('c1', h.foodInput());
    expect(q).toMatchObject({ discountIqd: 5000, totalIqd: 11500, lineSavingsIqd: [5000, 0] });
    const h2 = ordersHarness();
    await h2.promotions.addDeal({ type: 'fixed', value: 2000, itemIds: ['tikka'] });
    expect(await h2.orders.quote('c1', h2.foodInput())).toMatchObject({ discountIqd: 2000, lineSavingsIqd: [0, 2000], totalIqd: 14500 });
  });

  it('one deal per order: the bigger saving wins; a minimum not met is the cart nudge instead', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'free_delivery' });
    const pct = await h.promotions.addDeal({ type: 'percent', value: 10 });
    expect((await h.orders.quote('c1', h.foodInput())).discount?.promotionId).toBe(pct.id);
    const h2 = ordersHarness();
    const big = await h2.promotions.addDeal({ type: 'free_delivery', minOrderIqd: 20000 });
    expect(await h2.orders.quote('c1', h2.foodInput())).toMatchObject({ discount: null, discountIqd: 0, totalIqd: 16500, nextDeal: { dealId: big.id, missingIqd: 5000, label_ar: 'توصيل مجاني فوق 20,000 دينار' } });
  });

  it('a deal that ended or was switched off between cart and place: friendly refresh, never a silent change', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 20 });
    const q = await h.orders.quote('c1', h.foodInput());
    await h.promotions.dealRepo.updateDeal(d.id, { active: false });
    expect(await code(h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd })))).toBe('deal_changed');
    // The refreshed cart (no discount now) goes through at the full price.
    const again = await h.orders.quote('c1', h.foodInput());
    expect(again).toMatchObject({ discountIqd: 0, totalIqd: 16500 });
    expect((await h.orders.place('c1', h.foodInput({ discountIqd: again.discountIqd }))).totalIqd).toBe(16500);
    expect(await h.promotions.spent(d.id)).toBe(0);
  });

  it('budget cap under concurrent orders: exactly what fits is spent, the rest are asked to refresh', async () => {
    const h = ordersHarness();
    // 20 % of 15,000 = 3,000 per order; a 10,000 cap fits three.
    const d = await h.promotions.addDeal({ type: 'percent', value: 20, budgetCapIqd: 10_000 });
    const results = await Promise.all(Array.from({ length: 8 }, () => code(h.orders.place('c1', h.foodInput({ discountIqd: 3000 })))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'deal_changed')).toHaveLength(5);
    expect(await h.promotions.spent(d.id)).toBe(9000);
    // With 1,000 left the deal no longer applies to a basket that needs 3,000: the quote shows no discount.
    expect(await h.orders.quote('c1', h.foodInput())).toMatchObject({ discountIqd: 0, totalIqd: 16500 });
    // And the badge stays while some budget is left.
    expect(await h.promotions.badges('rest_1', h.clock.now())).toHaveLength(1);
  });

  it('a cancelled or rejected order gives the deal its spend back', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 20, budgetCapIqd: 6000 });
    const a = await h.orders.place('c1', h.foodInput({ discountIqd: 3000 }));
    const b = await h.orders.place('c1', h.foodInput({ discountIqd: 3000 }));
    expect(await h.promotions.spent(d.id)).toBe(6000);
    await h.orders.cancel('c1', { orderId: a.id });
    expect(await h.promotions.spent(d.id)).toBe(3000);
    await h.orders.merchantReject('m1', { orderId: b.id, reason: 'زحمة' });
    expect(await h.promotions.spent(d.id)).toBe(0);
  });

  it('partial accept re-prices the deal on what is left; approval releases the difference', async () => {
    const h = ordersHarness();
    const d = await h.promotions.addDeal({ type: 'percent', value: 20 });
    const o = await h.orders.place('c1', h.foodInput({ discountIqd: 3000 }));
    const tikka = o.lines.find((l) => l.catalogItemId === 'tikka')!;
    const proposed = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: [tikka.id] });
    // 20 % of the 10,000 left = 2,000; 10,000 + 1,500 fees − 2,000 = 9,500.
    expect(proposed.partial).toMatchObject({ reducedItemsTotalIqd: 10000, reducedTotalIqd: 9500 });
    const approved = await h.orders.respondPartial('c1', { orderId: o.id, approve: true });
    expect(approved).toMatchObject({ itemsTotalIqd: 10000, discountIqd: 2000, totalIqd: 9500 });
    expect(await h.promotions.spent(d.id)).toBe(2000);
  });

  it('platform codes still need a promotion the server resolves; the larger of code and deal wins', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'free_delivery' });
    h.promotions.codes.set('BIG', { promotionId: 'promo_launch', discountIqd: 2000 });
    const o = await h.orders.place('c1', h.foodInput({ promoCode: 'BIG' }));
    expect(o).toMatchObject({ discountIqd: 2000, discount: { funder: 'platform', target: 'order' } });
  });

  it('storefront badges: live deals with budget left, as the card shows them', async () => {
    const h = ordersHarness();
    await h.promotions.addDeal({ type: 'percent', value: 20 });
    await h.promotions.addDeal({ type: 'free_delivery', minOrderIqd: 15000, proposalState: 'pending_approval' });
    const store = new OrdersStorefrontMerchants(h.merchants, h.promotions);
    expect((await store.deals('rest_1', h.clock.now())).map((b) => b.label_ar)).toEqual(['خصم 20% على كل المنيو']);
  });
});
