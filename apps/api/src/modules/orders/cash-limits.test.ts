import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { ledgerHarness } from '../ledger/test-harness.js';
import { staffHarness } from './staff-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const make = (patch: Parameters<typeof staffHarness>[0] = {}) => staffHarness(patch, { ledger: ledgerHarness() });

/** A cash order the customer cancels after the kitchen accepted it: 500 owed to the kitchen. */
async function lateCancel(h: ReturnType<typeof make>, customer: string, prep = false) {
  const o = await h.orders.place(customer, h.foodInput());
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  if (prep) await h.orders.markPreparing('m1', { orderId: o.id });
  await h.orders.cancel(customer, { orderId: o.id });
  await h.settle();
  return o;
}

describe('cash standing (THIN-01 / M-3, SEC-10 / M-4)', () => {
  it('switches off: shows what he owes and his open cash orders, never blocks', async () => {
    const h = make();
    await lateCancel(h, 'c1');
    await lateCancel(h, 'c1');
    await lateCancel(h, 'c1', true);
    await h.orders.place('c1', h.foodInput());
    await h.orders.place('c1', h.foodInput());
    const s = await h.cashLimits.standing('c1');
    expect(s).toEqual({ owedIqd: 16_000, unpaidFees: 3, openCashOrders: 2, openCashLimit: null, cashAllowed: true, blockedBy: null });
    expect(await code(h.cashLimits.newCustomerCash('c1', 16_500))).toBe('ok');
  });

  it('M-4 on: a new account may have 1 open cash order, an established one 2; a dispute under review does not count', async () => {
    const h = make({ openCash: { enabled: true } });
    h.cashRisk.prior.set('fresh', 3);
    await h.orders.place('fresh', h.foodInput());
    expect(await h.cashLimits.standing('fresh')).toMatchObject({ openCashOrders: 1, openCashLimit: 1, blockedBy: 'open_cash_orders_cap' });
    expect(await code(h.cashLimits.newCustomerCash('fresh', 16_500))).toBe('open_cash_orders_cap');

    for (let i = 0; i < 3; i++) await h.delivered({ customer: 'c1' });
    expect(await h.cashLimits.standing('c1')).toMatchObject({ openCashLimit: 2, cashAllowed: true });
    await h.orders.place('c1', h.foodInput());
    expect(await code(h.cashLimits.newCustomerCash('c1', 16_500))).toBe('ok');
    await h.orders.place('c1', h.foodInput());
    expect(await code(h.cashLimits.newCustomerCash('c1', 16_500))).toBe('open_cash_orders_cap');
  });

  it('M-3 on: two unpaid fees, or more than 5,000 owed, stop cash orders; paying it back reopens them', async () => {
    const h = make({ cashDebt: { block: true } });
    await lateCancel(h, 'c1');
    expect(await h.cashLimits.standing('c1')).toMatchObject({ owedIqd: 500, unpaidFees: 1, cashAllowed: true });
    await lateCancel(h, 'c1');
    expect(await h.cashLimits.standing('c1')).toMatchObject({ owedIqd: 1_000, unpaidFees: 2, blockedBy: 'cash_debt_blocked' });
    expect(await code(h.cashLimits.newCustomerCash('c1', 16_500))).toBe('cash_debt_blocked');
    // paid at an agent: the wallet is back at 0
    await h.ledger.recordAll({ id: 'topup:t1', kind: 'money', occurredAt: h.clock.now(), refs: {}, lines: [{ type: 'credit_issued', amount: 1_000, fromAccount: 'bank', toAccount: 'customer:c1' }], controls: [] });
    expect(await h.cashLimits.standing('c1')).toMatchObject({ owedIqd: 0, unpaidFees: 0, cashAllowed: true });

    const big = make({ cashDebt: { block: true } });
    await lateCancel(big, 'c2', true);
    expect(await big.cashLimits.standing('c2')).toMatchObject({ owedIqd: 15_000, unpaidFees: 1, blockedBy: 'cash_debt_blocked' });
  });

  it('M-4 prepay on: after «ما جاوب بالباب» the next order must be from the wallet', async () => {
    for (const on of [false, true]) {
      const h = make({ openCash: { prepayAfterNoAnswer: on } });
      const o = await h.orders.place('c1', h.foodInput());
      await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
      const t = await h.tripFor(o.id);
      await h.pickup(t.id);
      const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
      await h.trips.arrive(t.id, drop.id, 'd1', { pin: { lat: 32.9185, lng: 45.0712 } });
      await h.trips.startUnreachable(t.id, drop.id, 'd1');
      await h.advance(5 * 60_000);
      await h.trips.fail(t.id, { personId: 'd1', role: 'driver' } as never);
      await h.deliver();
      expect((await h.orders.get(o.id)).state).toBe('disputed');
      expect((await h.cashLimits.standing('c1')).blockedBy).toBe(on ? 'prepay_required' : null);
    }
  });
});
