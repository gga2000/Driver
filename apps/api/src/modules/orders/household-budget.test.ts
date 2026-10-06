import { describe, expect, it } from 'vitest';
import { DriverError, HOUSEHOLD_RULES } from '@driver/contracts';
import { ordersHarness } from './test-harness.js';

const MIN = 60_000;

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * Joy w4: payer `p1`, orderer `c1` (20,000 an order, 40,000 a month), `kid` uses places only. The
 * household wallet holds 200,000. `foodInput()` costs 16,500.
 */
async function family(start?: string) {
  const h = ordersHarness(start);
  const home = await h.orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: 'p1' });
  await h.orgs.addMember(home.id, 'c1', { role: 'orderer', spendingLimitIqd: 20_000, actorId: 'p1' });
  await h.orgs.setMonthlyBudget(home.id, 'c1', 40_000, 'p1');
  await h.orgs.addMember(home.id, 'kid', { role: 'member', actorId: 'p1' });
  h.wallets.set(`household:${home.id}`, 200_000);
  const onHome = (patch: Parameters<typeof h.foodInput>[0] = {}) => h.foodInput({ householdOrgId: home.id, paymentMethod: 'wallet', ...patch });
  return { h, home, onHome };
}

describe('orders.place on the household wallet (joy w4)', () => {
  it('only payers and orderers spend it; strangers and place-only members are refused', async () => {
    const { h, onHome } = await family();
    expect(await code(h.orders.place('stranger', onHome()))).toBe('household_cannot_order');
    expect(await code(h.orders.place('kid', onHome()))).toBe('household_cannot_order');
    expect(await code(h.orders.place('c1', onHome({ householdOrgId: 'org_nope' })))).toBe('household_cannot_order');
    expect(await code(h.orders.place('p1', onHome()))).toBe('ok');
  });

  it('kitchen and shop orders only: a ride cannot wait for a yes', async () => {
    const { h, home } = await family();
    const ride = { cityId: 'aziziyah', type: 'ride' as const, householdOrgId: home.id, paymentMethod: 'wallet' as const, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'zakur' } };
    expect(await code(h.orders.place('c1', ride))).toBe('household_wallet_food_only');
  });

  it('within the limit and the budget it goes straight to the kitchen', async () => {
    const { h, onHome } = await family();
    const o = await h.orders.place('c1', onHome({ familyTable: true }));
    expect(o).toMatchObject({ state: 'placed', familyTable: true });
    expect(o.heldForPayer).toBeUndefined();
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.offered_to_merchant']);
  });

  it('over the per-order limit: held, the kitchen sees nothing, the payer is asked with the reason', async () => {
    const { h, home, onHome } = await family();
    const o = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    expect(o).toMatchObject({ state: 'placed', heldForPayer: true, merchantOfferedAt: null });
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.awaiting_payer']);
    expect(await h.orgs.approvalForOrder(home.id, o.id)).toMatchObject({ requestedBy: 'c1', payerId: 'p1', amountIqd: o.totalIqd, state: 'pending', reason: 'order_limit' });
    // The payer himself is never limited.
    const big = await h.orders.place('p1', onHome({ lines: [{ catalogItemId: 'tray', qty: 5, unitPriceIqd: 10_000 }] }));
    expect(big.heldForPayer).toBeUndefined();
  });

  it('the month counts earlier household orders (not cancelled ones, not his own wallet)', async () => {
    const { h, home, onHome } = await family();
    const first = await h.orders.place('c1', onHome()); // 16,500
    await h.orders.place('c1', h.foodInput()); // cash, his own — never counts
    const cancelled = await h.orders.place('c1', onHome());
    await h.orders.cancel('c1', { orderId: cancelled.id });
    const second = await h.orders.place('c1', onHome()); // 33,000 so far
    expect(second.heldForPayer).toBeUndefined();
    const third = await h.orders.place('c1', onHome()); // would be 49,500 > 40,000
    expect(third.heldForPayer).toBe(true);
    expect((await h.orgs.approvalForOrder(home.id, third.id))?.reason).toBe('month_budget');
    expect(first.id).not.toBe(third.id);
  });

  it('two orders placed at the same moment never both slip under the month: the second is held', async () => {
    const { h, home, onHome } = await family();
    await h.orgs.setMonthlyBudget(home.id, 'c1', 30_000, 'p1'); // each 16,500 fits alone; both don't
    const [a, b] = await Promise.all([h.orders.place('c1', onHome()), h.orders.place('c1', onHome())]);
    expect([a.heldForPayer ?? false, b.heldForPayer ?? false].sort()).toEqual([false, true]);
    const held = a.heldForPayer ? a : b;
    expect((await h.orgs.approvalForOrder(home.id, held.id))?.reason).toBe('month_budget');
    // Another member's orders are not serialised behind his (one lock per member).
    await h.orgs.addMember(home.id, 'c2', { role: 'orderer', actorId: 'p1' });
    h.cashRisk.prior.set('c2', 3);
    const [c, d] = await Promise.all([h.orders.place('c2', onHome()), h.orders.place('p1', onHome())]);
    expect([c.heldForPayer, d.heldForPayer]).toEqual([undefined, undefined]);
  });

  it('a new Baghdad month starts the budget again', async () => {
    const { h, onHome } = await family('2026-10-31T09:00:00Z'); // noon on the 31st, Baghdad
    await h.orders.place('c1', onHome());
    await h.orders.place('c1', onHome());
    expect((await h.orders.place('c1', onHome())).heldForPayer).toBe(true);
    h.clock.set('2026-11-01T09:00:00Z'); // noon on 1 November
    expect((await h.orders.place('c1', onHome())).heldForPayer).toBeUndefined();
  });

  it('the payer says yes: the kitchen gets it now (and a repeated answer changes nothing)', async () => {
    const { h, onHome } = await family();
    const o = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    await h.orders.onPayerDecision(o.id, 'approved');
    const after = await h.orders.get(o.id);
    expect(after.heldForPayer).toBeUndefined();
    expect(after.merchantOfferedAt).not.toBeNull();
    await h.orders.onPayerDecision(o.id, 'declined');
    expect((await h.orders.get(o.id)).state).toBe('placed');
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.awaiting_payer', 'order.payer_approved', 'order.offered_to_merchant']);
  });

  it('a scheduled order approved early still reaches the kitchen at its time', async () => {
    const { h, onHome } = await family();
    const at = new Date(h.clock.now().getTime() + 3 * 60 * MIN);
    const o = await h.orders.place('c1', onHome({ scheduledFor: at, lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    await h.orders.onPayerDecision(o.id, 'approved');
    expect((await h.orders.get(o.id)).merchantOfferedAt).toBeNull();
    await h.advance(3 * 60 * MIN);
    expect((await h.orders.get(o.id)).merchantOfferedAt).not.toBeNull();
  });

  it('the payer says no: cancelled free, never offered', async () => {
    const { h, onHome } = await family();
    const o = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    await h.orders.onPayerDecision(o.id, 'declined');
    expect(await h.orders.get(o.id)).toMatchObject({ state: 'platform_cancelled', cancellationReason: 'payer_declined', cancellationFeeIqd: 0, merchantOfferedAt: null });
  });

  it('nobody answers: cancelled free after the wait and the request withdrawn; an answer that landed stands', async () => {
    const { h, home, onHome } = await family();
    const silent = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    await h.advance(HOUSEHOLD_RULES.approvalWaitMin * MIN);
    expect(await h.orders.get(silent.id)).toMatchObject({ state: 'platform_cancelled', cancellationReason: 'payer_no_answer', cancellationFeeIqd: 0 });
    expect((await h.orgs.approvalForOrder(home.id, silent.id))?.state).toBe('withdrawn');

    // The payer said yes but the hand-off to orders was lost: the timer releases it to the kitchen.
    const lost = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    const req = await h.orgs.approvalForOrder(home.id, lost.id);
    await h.orgs.resolvePayerApproval(req!.id, 'p1', 'approved');
    await h.advance(HOUSEHOLD_RULES.approvalWaitMin * MIN);
    expect((await h.orders.get(lost.id)).merchantOfferedAt).not.toBeNull();
  });

  it('the orderer cancels a held order: free, and the payer is no longer asked', async () => {
    const { h, home, onHome } = await family();
    const o = await h.orders.place('c1', onHome({ lines: [{ catalogItemId: 'tray', qty: 2, unitPriceIqd: 10_000 }] }));
    expect(await h.orders.cancel('c1', { orderId: o.id })).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 0 });
    expect((await h.orgs.approvalForOrder(home.id, o.id))?.state).toBe('withdrawn');
  });

  it('reads a household month for the hub: its wallet orders and the members’ family-table orders', async () => {
    const { h, home, onHome } = await family();
    const a = await h.orders.place('c1', onHome());
    const b = await h.orders.place('p1', h.foodInput({ familyTable: true }));
    await h.orders.place('p1', h.foodInput());
    const { from, to } = { from: new Date(h.clock.now().getTime() - MIN), to: new Date(h.clock.now().getTime() + MIN) };
    expect((await h.orders.householdOrdersBetween(home.id, ['p1', 'c1'], from, to)).map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
  });
});
