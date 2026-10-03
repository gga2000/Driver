import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { ledgerHarness, workedExample } from './test-harness.js';

const t0 = new Date('2026-10-03T12:00:00Z');
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);

describe('merchant cash account (decisions §3)', () => {
  it('every cash order instantly credits the merchant net of commission; the live balance shows who holds it', async () => {
    const h = ledgerHarness();
    await h.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1', occurredAt: minutes(0) }));
    await h.posting.orderMoney(workedExample({ orderId: 'o2', courierId: 'k1', occurredAt: minutes(5) }));
    await h.posting.orderMoney(workedExample({ orderId: 'o3', courierId: 'k2', occurredAt: minutes(9) }));
    const view = await h.merchantCash.balance('m1');
    expect(view).toMatchObject({ merchantId: 'm1', balanceIqd: 38250, mode: 'nightly_courier', exposureCapIqd: 300000, overExposure: false, lastRequestedAt: null });
    expect(view.holders).toEqual([
      { courierId: 'k1', amountIqd: 25500 },
      { courierId: 'k2', amountIqd: 12750 },
    ]);
  });

  it('exposure cap 300,000 triggers one automatic settlement request, routed to the courier holding most', async () => {
    const h = ledgerHarness();
    for (let i = 0; i < 23; i++) await h.posting.orderMoney(workedExample({ orderId: `a${i}`, courierId: i % 2 ? 'k1' : 'k2', occurredAt: minutes(i) }));
    expect(h.bus.types()).not.toContain('merchant.settlement_requested'); // 23 × 12,750 = 293,250
    await h.posting.orderMoney(workedExample({ orderId: 'a23', courierId: 'k2', occurredAt: minutes(23) }));
    const req = h.bus.last('merchant.settlement_requested');
    expect(req?.payload).toMatchObject({ merchantId: 'm1', reason: 'exposure_cap', balanceIqd: 306000 });
    expect((await h.merchantCash.balance('m1')).lastRequestedAt).not.toBeNull();

    // While the request is open, more orders do not request again.
    await h.posting.orderMoney(workedExample({ orderId: 'a24', courierId: 'k1', occurredAt: minutes(24) }));
    expect(h.bus.types().filter((t) => t === 'merchant.settlement_requested')).toHaveLength(1);

    // The subscriber routes it and announces the assignment.
    await h.bus.publish('merchant.settlement_requested', req!.payload);
    expect(h.bus.last('merchant.settlement_assigned')?.payload).toMatchObject({ merchantId: 'm1', channel: 'courier', courierId: 'k2', amountIqd: 13 * 12750, reason: 'exposure_cap' });
    // Same reference as the request, so the Merchant app follows one request from ask to hand-over.
    expect(h.bus.last('merchant.settlement_assigned')?.payload['reference']).toBe(req!.payload['reference']);
  });

  it('"اطلب فلوسك": nothing due is refused; otherwise a plan by mode with a settlement reference', async () => {
    const h = ledgerHarness();
    await expect(h.merchantCash.requestSettlement('m1', 'owner1')).rejects.toMatchObject({ code: 'settlement_nothing_due' });
    await h.posting.orderMoney(workedExample({ orderId: 'o1' }));
    const plan = await h.merchantCash.requestSettlement('m1', 'owner1');
    expect(plan).toMatchObject({ merchantId: 'm1', channel: 'courier', courierId: 'k1', amountIqd: 12750, reason: 'merchant_request' });
    expect(plan.reference).toMatch(/^M-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(plan.targetBy.getTime() - h.clock.now().getTime()).toBe(3_600_000);
    expect(h.bus.last('merchant.settlement_requested')?.actorId).toBe('owner1');

    await h.merchantCash.configure('m2', { mode: 'daily_zaincash' });
    await h.posting.orderMoney(workedExample({ orderId: 'o2', merchantId: 'm2' }));
    expect((await h.merchantCash.requestSettlement('m2', 'owner2')).channel).toBe('zaincash');
  });

  it('hand-over needs the PIN and both confirmations; any mismatch opens an incident and posts nothing', async () => {
    const h = ledgerHarness();
    await h.merchantCash.configure('m1', { pin: '4321' });
    await h.posting.orderMoney(workedExample({ orderId: 'o1' }));
    const base = { handoverId: 'h1', courierId: 'k1', merchantId: 'm1', amountIqd: 12750, merchantConfirmedIqd: 12750 };

    await expect(h.merchantCash.confirmHandover({ ...base, pin: '0000' })).rejects.toBeInstanceOf(DriverError);
    await expect(h.merchantCash.confirmHandover({ ...base, pin: '4321', merchantConfirmedIqd: 12000 })).rejects.toMatchObject({ code: 'handover_mismatch' });
    await expect(h.merchantCash.confirmHandover({ ...base, pin: '4321', amountIqd: 20000, merchantConfirmedIqd: 20000 })).rejects.toMatchObject({ code: 'handover_mismatch' });
    expect(h.incidents.opened().map((i) => i.kind)).toEqual(['merchant_handover_discrepancy', 'merchant_handover_discrepancy', 'merchant_handover_discrepancy']);
    expect((await h.merchantCash.balance('m1')).balanceIqd).toBe(12750);

    const res = await h.merchantCash.confirmHandover({ ...base, pin: '4321' });
    expect(res).toEqual({ postedIqd: 12750, merchantBalanceIqd: 0 });
    const view = await h.merchantCash.balance('m1');
    expect(view.holders).toEqual([]);
    expect(view.lastSettledAt).not.toBeNull();
    expect(h.bus.last('merchant.paid_by_courier')?.payload).toMatchObject({ handoverId: 'h1', amountIqd: 12750 });
    // The courier now owes only the platform's 2,750.
    expect((await h.caps.status('k1')).owedIqd).toBe(2750);
  });

  it('courier return route: merchants in a courier-settled mode he owes, largest first', async () => {
    const h = ledgerHarness();
    await h.merchantCash.configure('m2', { mode: 'on_demand' });
    await h.merchantCash.configure('m3', { mode: 'daily_zaincash' });
    await h.posting.orderMoney(workedExample({ orderId: 'o1', merchantId: 'm1' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o2', merchantId: 'm1' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o3', merchantId: 'm2', itemsSubtotalIqd: 8000, commissionTier: 'base' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o4', merchantId: 'm3' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o5', merchantId: 'm1', courierId: 'k2' }));
    expect(await h.merchantCash.returnRoute('k1')).toEqual([
      { merchantId: 'm1', amountIqd: 25500, mode: 'nightly_courier' },
      { merchantId: 'm2', amountIqd: 7040, mode: 'on_demand' },
    ]);
    await h.merchantCash.confirmHandover({ handoverId: 'h1', courierId: 'k1', merchantId: 'm1', amountIqd: 25500, merchantConfirmedIqd: 25500, tabletTap: true });
    expect(await h.merchantCash.returnRoute('k1')).toEqual([{ merchantId: 'm2', amountIqd: 7040, mode: 'on_demand' }]);
    expect(await h.merchantCash.returnRoute('k2')).toEqual([{ merchantId: 'm1', amountIqd: 12750, mode: 'nightly_courier' }]);
  });

  it('a company payout settles the oldest held cash first; those couriers then owe the platform', async () => {
    const h = ledgerHarness();
    await h.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1', occurredAt: minutes(0) }));
    await h.posting.orderMoney(workedExample({ orderId: 'o2', courierId: 'k2', occurredAt: minutes(1) }));
    h.clock.set(minutes(2));
    expect(await h.merchantCash.recordPayout({ merchantId: 'm1', amountIqd: 12750, channel: 'zaincash', reference: 'M-PAY-1' })).toBe(12750);
    expect((await h.merchantCash.balance('m1')).holders).toEqual([{ courierId: 'k2', amountIqd: 12750 }]);
    expect(await h.merchantCash.returnRoute('k1')).toEqual([]);
    expect((await h.caps.status('k1')).owedIqd).toBe(15500);
  });
});
