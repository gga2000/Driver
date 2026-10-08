import { describe, expect, it } from 'vitest';
import { AFTER_TIP_MEMO, DriverError } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { Accounts } from '../ledger/accounts.js';
import { moneyLines } from '../ledger/customer-wallet.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { WalletHolds } from '../ledger/wallet-holds.js';
import { ordersHarness } from './test-harness.js';
import { OrderTipsService } from './tips.js';

/**
 * «تحب تكرم عباس؟» (Ali, 2026-10-06, "do whatever is best"): the tip after a 4–5 rating — from the
 * customer's own wallet, 100 % to the driver, once per order, within 24 h of delivery, every rule on
 * the server.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

async function setup(opts: { wallet?: number; tipAtCheckout?: number; holds?: WalletHolds } = {}) {
  const h = ordersHarness();
  const lh = ledgerHarness({ clock: h.clock });
  const ev = createInMemoryEvents({ clock: h.clock });
  const tips = new OrderTipsService(h.orders, h.trips, lh.ledger, ev.events, h.clock, undefined, undefined, opts.holds);
  // His wallet: a top-up at an agent (bank → customer).
  if (opts.wallet) await lh.ledger.recordAll({ id: 'topup:1', kind: 'money', occurredAt: h.clock.now(), refs: {}, lines: [{ type: 'credit_issued', amount: opts.wallet, fromAccount: 'bank', toAccount: Accounts.customer('c1'), memo: 'topup:agent' }], controls: [] });
  const o = await h.orders.place('c1', h.foodInput(opts.tipAtCheckout ? { tipIqd: opts.tipAtCheckout } : {}));
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  const t = await h.tripFor(o.id);
  await h.pickup(t.id);
  const delivered = { h, lh, ev, tips, o, t };
  return {
    ...delivered,
    deliver: async () => h.dropoff(t.id, { cashCollectedIqd: (await h.orders.get(o.id)).totalIqd }),
    rate: (delivery: number) => h.orders.rate('c1', { orderId: o.id, delivery, food: 5 }),
  };
}

describe('tip after a good rating — the offer', () => {
  it('shows only after delivery and a 4–5 rating, with the chips his wallet covers', async () => {
    const s = await setup({ wallet: 1_500 });
    expect(await s.tips.options('c1', s.o.id)).toMatchObject({ offered: false, reason: 'not_delivered', amountsIqd: [] });
    await s.deliver();
    expect(await s.tips.options('c1', s.o.id)).toMatchObject({ offered: false, reason: 'not_rated' });
    await s.rate(5);
    const offer = await s.tips.options('c1', s.o.id);
    // 2,000 is more than his 1,500: no chip for it.
    expect(offer).toMatchObject({ offered: true, reason: null, amountsIqd: [500, 1000], walletIqd: 1_500, tip: null });
    expect(offer.untilAt!.getTime() - (await s.h.orders.get(s.o.id)).deliveredAt!.getTime()).toBe(24 * 3_600_000);
  });

  it('is not offered below 4 stars, after a checkout tip, past 24 h, or to someone else', async () => {
    const low = await setup({ wallet: 5_000 });
    await low.deliver();
    await low.rate(3);
    expect(await low.tips.options('c1', low.o.id)).toMatchObject({ offered: false, reason: 'low_rating', amountsIqd: [] });
    expect(await code(low.tips.tip('c1', { orderId: low.o.id, amountIqd: 1000 }))).toBe('tip_not_offered');

    const checkout = await setup({ wallet: 5_000, tipAtCheckout: 1000 });
    await checkout.deliver();
    await checkout.rate(5);
    expect(await checkout.tips.options('c1', checkout.o.id)).toMatchObject({ offered: false, reason: 'tipped_at_checkout' });
    expect(await code(checkout.tips.tip('c1', { orderId: checkout.o.id, amountIqd: 1000 }))).toBe('tip_already_given');

    const late = await setup({ wallet: 5_000 });
    await late.deliver();
    await late.rate(4);
    late.h.clock.advance(24 * 3_600_000 + 60_000);
    expect(await late.tips.options('c1', late.o.id)).toMatchObject({ offered: false, reason: 'window_closed' });
    expect(await code(late.tips.tip('c1', { orderId: late.o.id, amountIqd: 500 }))).toBe('tip_window_closed');
    expect(await code(late.tips.options('c2', late.o.id))).toBe('forbidden');
  });

  it('with an empty wallet it is offered with no chips (the app shows the cash note)', async () => {
    const s = await setup();
    await s.deliver();
    await s.rate(5);
    expect(await s.tips.options('c1', s.o.id)).toMatchObject({ offered: true, amountsIqd: [], walletIqd: 0 });
    expect(await code(s.tips.tip('c1', { orderId: s.o.id, amountIqd: 500 }))).toBe('wallet_insufficient');
    expect(await s.lh.ledger.eventsForGroups([`tip:${s.o.id}`])).toEqual([]);
  });
});

describe('tip after a good rating — the money', () => {
  it('posts one balanced line wallet → driver, 100 % his, and tells the driver', async () => {
    const s = await setup({ wallet: 5_000 });
    await s.deliver();
    await s.rate(5);
    const r = await s.tips.tip('c1', { orderId: s.o.id, amountIqd: 1000 });
    expect(r).toMatchObject({ orderId: s.o.id, amountIqd: 1000, walletIqd: 4_000 });
    const lines = await s.lh.ledger.eventsForGroups([`tip:${s.o.id}`]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'tip', amount: 1000, fromAccount: 'customer:c1', toAccount: 'driver:d1', memo: AFTER_TIP_MEMO, orderId: s.o.id, tripId: s.t.id });
    expect((await s.lh.ledger.balance(Accounts.customer('c1'))).amount).toBe(4_000);
    expect((await s.lh.ledger.balance(Accounts.driver('d1'))).amount).toBe(1000);
    expect((await s.lh.ledger.checkInvariant()).ok).toBe(true);
    const e = (await s.ev.events.forOrder(s.o.id)).filter((x) => x.type === 'order.tipped');
    expect(e).toHaveLength(1);
    expect(e[0]!.payload).toEqual({ customerId: 'c1', courierId: 'd1', tripId: s.t.id, amountIqd: 1000 });
    // The offer now thanks him instead of asking again.
    expect(await s.tips.options('c1', s.o.id)).toMatchObject({ offered: true, amountsIqd: [], tip: { amountIqd: 1000 } });
    // His wallet reads it as one line, «إكرامية · طلب #…».
    const wallet = moneyLines('customer:c1', await s.lh.ledger.eventsFor('customer:c1')).find((l) => l.kind === 'tip')!;
    expect(wallet).toMatchObject({ amount: -1000, title_ar: 'إكرامية', orderId: s.o.id });
    expect(wallet.detail_ar).toMatch(/^طلب #\d{4}$/);
  });

  it('is once per order: the same amount again returns it, another amount is refused, nothing posts twice', async () => {
    const s = await setup({ wallet: 5_000 });
    await s.deliver();
    await s.rate(5);
    const [a, b] = await Promise.all([s.tips.tip('c1', { orderId: s.o.id, amountIqd: 2000 }), s.tips.tip('c1', { orderId: s.o.id, amountIqd: 2000 })]);
    expect(a.amountIqd).toBe(2000);
    expect(b.amountIqd).toBe(2000);
    expect(await code(s.tips.tip('c1', { orderId: s.o.id, amountIqd: 500 }))).toBe('tip_already_given');
    expect(await s.lh.ledger.eventsForGroups([`tip:${s.o.id}`])).toHaveLength(1);
    expect((await s.lh.ledger.balance(Accounts.customer('c1'))).amount).toBe(3_000);
  });

  it('only the configured chips; not from an open wallet order\'s money', async () => {
    const s = await setup({ wallet: 17_500 });
    await s.deliver();
    await s.rate(5);
    expect(await code(s.tips.tip('c1', { orderId: s.o.id, amountIqd: 750 }))).toBe('tip_amount_invalid');
    // A 16,500 wallet order still open holds most of his 17,500: 1,000 left, so 2,000 is refused.
    s.h.wallets.set('customer:c1', 17_500);
    await s.h.orders.place('c1', s.h.foodInput({ paymentMethod: 'wallet' }));
    expect(await s.tips.walletIqd('c1')).toBe(1_000);
    expect(await code(s.tips.tip('c1', { orderId: s.o.id, amountIqd: 2000 }))).toBe('wallet_insufficient');
    expect((await s.tips.tip('c1', { orderId: s.o.id, amountIqd: 1000 })).walletIqd).toBe(0);
  });

  it('SEC-07: not from money a prepaid seat or a request deposit holds either', async () => {
    const holds = new WalletHolds();
    holds.register('routes', async (customerId) => (customerId === 'c1' ? 1_500 : 0));
    // The orders module's own source is counted by the tip itself, never twice.
    holds.register('orders', async () => 99_000);
    const s = await setup({ wallet: 2_500, holds });
    await s.deliver();
    await s.rate(5);
    expect(await s.tips.walletIqd('c1')).toBe(1_000);
    expect(await code(s.tips.tip('c1', { orderId: s.o.id, amountIqd: 2000 }))).toBe('wallet_insufficient');
    expect((await s.tips.tip('c1', { orderId: s.o.id, amountIqd: 1000 })).walletIqd).toBe(0);
  });
});
