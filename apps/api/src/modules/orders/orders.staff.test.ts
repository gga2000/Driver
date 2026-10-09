import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { ledgerHarness } from '../ledger/test-harness.js';
import { DEFAULT_ORDER_OUTCOME_RULES, DISPUTE_OUTCOMES, outcomeRulesFromEnv } from './outcomes.config.js';
import { staffHarness } from './staff-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const ops: Actor = { personId: 'ops_1', roles: ['dispatcher'] } as unknown as Actor;
const ali: Actor = { personId: 'ali', roles: ['admin'] } as unknown as Actor;
const all = { disputes: { outcomes: [...DISPUTE_OUTCOMES] } };
const make = (patch: Parameters<typeof staffHarness>[0] = {}) => staffHarness(patch, { ledger: ledgerHarness() });

describe('W3 switches', () => {
  it('every money outcome is off by default, from code and from an empty environment', () => {
    expect(DEFAULT_ORDER_OUTCOME_RULES.disputes.outcomes).toEqual([]);
    expect(outcomeRulesFromEnv({})).toEqual(DEFAULT_ORDER_OUTCOME_RULES);
  });

  it('the environment switches each one on by name', () => {
    const r = outcomeRulesFromEnv({
      DISPUTE_OUTCOMES: 'stands, refund_partial,bogus',
      DISPUTE_AUTO_OUTCOME: 'on',
      PLATFORM_FAILURE_FREE_CANCEL: 'true',
      PLATFORM_FAILURE_FOOD_PAYER: 'merchant',
      CASH_DEBT_BLOCK: '1',
      OPEN_CASH_CAP: 'yes',
      PREPAY_AFTER_NO_ANSWER: 'on',
      COURIER_LOST_REFUND: 'on',
      COURIER_LOST_CHARGE: 'on',
      AGENT_CASH_ACCOUNTS: 'on',
      MERCHANT_REMAKE_PAY: 'on',
    });
    expect(r.disputes.outcomes).toEqual(['stands', 'refund_partial']);
    expect(r.disputes.auto.enabled).toBe(true);
    expect(r.platformFailure).toMatchObject({ freeCancel: true, cookedFoodPayer: 'merchant' });
    expect(r.cashDebt).toMatchObject({ block: true, collectOnNext: true });
    expect(r.openCash).toMatchObject({ enabled: true, prepayAfterNoAnswer: true });
    expect(r.courierLost).toEqual({ refund: true, chargeCourier: true });
    expect(r.agentCashAccounts).toBe(true);
    expect(r.remake).toEqual({ pay: true, afterReadyMin: 10 });
    expect(outcomeRulesFromEnv({ DISPUTE_OUTCOMES: 'all' }).disputes.outcomes).toEqual([...DISPUTE_OUTCOMES]);
  });
});

describe('orders.ops.switches', () => {
  it('tells the Console which money outcomes are on: all off by default, void always allowed', () => {
    expect(make().staff.switches()).toEqual({ disputeOutcomes: ['void'], agentLimitIqd: 25_000, courierLostRefund: false, courierLostCharge: false, freeCancel: false, cookedFoodPayer: 'platform', remakePay: true });
    const on = make({ disputes: { outcomes: ['stands', 'refund_full'], agentLimitIqd: 25_000, auto: { enabled: false, escalateAfterH: 48, standsAfterH: 72 } }, courierLost: { refund: true, chargeCourier: false } });
    expect(on.staff.switches()).toMatchObject({ disputeOutcomes: ['stands', 'refund_full', 'void'], courierLostRefund: true, courierLostCharge: false });
  });
});

describe('orders.ops.cancel (NTF-10)', () => {
  it('cancels before pickup, free for the customer, detaches the courier, pushes and audits with the reason', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    const r = await h.staff.cancel(ops, { orderId: o.id, reason: 'المطعم سكّر', onBehalfOfCustomer: false });
    expect(r).toMatchObject({ state: 'platform_cancelled', changed: true, postedIqd: 0 });
    expect(h.events.last('order.cancelled')!.payload).toMatchObject({ by: 'platform', free: true, feeIqd: 0, reason: 'staff_cancelled' });
    expect(h.events.last('order.ops_cancelled')!.payload).toMatchObject({ customerId: 'c1' });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'order.ops_cancel', actorId: 'ops_1', subjectId: o.id, id: r.auditId })]);
    expect(h.audits[0]!.summaryAr).toContain('المطعم سكّر');
    expect((await h.trips.activeForOrder(o.id))).toBeNull();
    expect((await h.trips.get(t.id)).state).toBe('platform_cancelled');
    // a replay changes nothing
    expect(await h.staff.cancel(ops, { orderId: o.id, reason: 'مرة ثانية', onBehalfOfCustomer: false })).toMatchObject({ changed: false });
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(0);
  });

  it('on behalf of the customer: his own cancel with his normal fee', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const r = await h.staff.cancel(ops, { orderId: o.id, reason: 'اتصل وطلب يلغي', onBehalfOfCustomer: true });
    expect(r.state).toBe('customer_cancelled');
    expect(h.events.last('order.cancelled')!.payload).toMatchObject({ by: 'customer', feeIqd: 500 });
    expect(h.audits[0]).toMatchObject({ action: 'order.ops_cancel', detail: { onBehalfOfCustomer: true, feeIqd: 500 } });
  });

  it('refuses after pickup (courier lost or mark delivered instead) and on a finished order', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    expect(await code(h.staff.cancel(ops, { orderId: o.id, reason: 'تجربة', onBehalfOfCustomer: false }))).toBe('order_cancel_after_pickup');
    expect(h.audits).toEqual([]);
  });

  it('cooked food: the kitchen is paid by the platform only with M-2 on and the platform as payer', async () => {
    for (const [patch, expected] of [
      [{}, 0],
      [{ platformFailure: { freeCancel: true, cookedFoodPayer: 'platform' as const } }, 15_000],
      [{ platformFailure: { freeCancel: true, cookedFoodPayer: 'merchant' as const } }, 0],
    ] as const) {
      const h = make(patch);
      const o = await h.orders.place('c1', h.foodInput());
      await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
      await h.orders.markPreparing('m1', { orderId: o.id });
      const r = await h.staff.cancel(ops, { orderId: o.id, reason: 'ماكو دليفري', onBehalfOfCustomer: false });
      expect(r.postedIqd).toBe(expected);
      expect(await h.balance('merchant_cash:rest_1')).toBe(expected);
      expect(await h.balance('customer:c1')).toBe(0);
    }
  });
});

describe('orders.ops.markDelivered / close (NTF-10)', () => {
  it('marks a picked-up cash order delivered as the courier would have, then closes it; a late drop-off is a no-op', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const r = await h.staff.markDelivered(ops, { orderId: o.id, reason: 'الدليفري سلّم وتلفونه طفى' });
    expect(r).toMatchObject({ state: 'delivered', changed: true });
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ amountIqd: o.totalIqd, courierId: 'd1' });
    await h.dropoff(t.id, { cashCollectedIqd: o.totalIqd });
    expect((await h.orders.get(o.id)).state).toBe('delivered');
    expect(await h.staff.markDelivered(ops, { orderId: o.id, reason: 'مرة ثانية' })).toMatchObject({ changed: false });
    const c = await h.staff.close(ops, { orderId: o.id, reason: 'الزبون أكد' });
    expect(c.state).toBe('closed');
    await h.settle();
    expect(await h.balance('driver:d1')).toBe(1_000);
    expect(h.audits.map((a) => a.action)).toEqual(['order.ops_mark_delivered', 'order.ops_close']);
    expect(await code(h.staff.close(ops, { orderId: o.id, reason: 'ثالث' }))).toBe('ok');
  });

  it('refuses a cash figure above the order total (the drop-off check): nothing written, the order still on the way', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    expect(await code(h.staff.markDelivered(ops, { orderId: o.id, reason: 'سلّم', cashCollectedIqd: o.totalIqd * 10 }))).toBe('change_to_wallet_mismatch');
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    expect(h.events.ofType('order.cash_collected')).toHaveLength(0);
    expect(h.audits).toEqual([]);
    // less than the total is what the courier may also report (the discrepancy is recorded)
    const r = await h.staff.markDelivered(ops, { orderId: o.id, reason: 'سلّم ناقص', cashCollectedIqd: o.totalIqd - 1_000 });
    expect(r.state).toBe('delivered');
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ amountIqd: o.totalIqd - 1_000 });
  });

  it('close refuses a disputed order (that is resolveDispute) and a live one', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    expect(await code(h.staff.close(ops, { orderId: o.id, reason: 'تجربة' }))).toBe('order_state_conflict');
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'cold_or_late' });
    expect(await code(h.staff.close(ops, { orderId: order.id, reason: 'تجربة' }))).toBe('order_state_conflict');
  });
});

describe('orders.ops.resolveDispute (NTF-01, M-1)', () => {
  it('is refused while the outcome is switched off', async () => {
    const h = make();
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'cold_or_late' });
    expect(await code(h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'stands', reason: 'مراجعة', faultParty: 'platform' }))).toBe('money_rule_off');
    expect((await h.orders.get(order.id)).state).toBe('disputed');
  });

  it('stands: the order closes and money settles as normal (merchant and courier paid, wallet charged once)', async () => {
    const h = make(all);
    const { order } = await h.delivered({ wallet: true });
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'cold_or_late' });
    expect(await h.orders.openWalletHoldIqd('c1')).toBe(order.totalIqd);
    const r = await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'stands', reason: 'الأكل وصل زين', faultParty: 'platform' });
    expect(r).toMatchObject({ state: 'closed', changed: true, postedIqd: 0 });
    await h.settle();
    expect(await h.orders.openWalletHoldIqd('c1')).toBe(0);
    expect(await h.balance('customer:c1')).toBe(-order.totalIqd);
    expect(await h.balance('driver:d1')).toBe(1_000);
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ outcome: 'stands', refundIqd: 0, customerId: 'c1' });
    // dispute_resolved_once: a second call changes nothing
    expect(await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_full', reason: 'ثاني', faultParty: 'platform' })).toMatchObject({ changed: false });
    expect(h.events.ofType('order.dispute_resolved')).toHaveLength(1);
  });

  it('refund_full: closes, then a refund from the party at fault back to the wallet; the order ends refunded', async () => {
    const h = make(all);
    const { order } = await h.delivered({ wallet: true });
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'wrong_item' });
    const r = await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_full', reason: 'طلب غلط', faultParty: 'merchant' });
    expect(r).toMatchObject({ state: 'refunded', postedIqd: order.totalIqd });
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(0);
    const refund = (await h.ledger.eventsForOrder(order.id)).filter((e) => e.type === 'refund');
    expect(refund).toEqual([expect.objectContaining({ amount: order.totalIqd, fromAccount: 'merchant_cash:rest_1', toAccount: 'customer:c1' })]);
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ outcome: 'refund_full', refundIqd: order.totalIqd, funder: 'merchant' });
    expect((await h.ledger.checkInvariant()).ok).toBe(true);
  });

  it('above the limit a complaint refund waits for a second OK (admins too); someone else approves, then it posts once', async () => {
    const h = staffHarness({ disputes: { outcomes: [...DISPUTE_OUTCOMES], agentLimitIqd: 2_000 } }, { ledger: ledgerHarness(), approvals: true });
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'missing_item' });
    const asked = await h.staff.resolveDispute(ali, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص صنف', faultParty: 'courier' });
    expect(asked).toMatchObject({ state: 'disputed', changed: false, postedIqd: 0, pendingApprovalId: expect.any(String) });
    // Asking again is the same request; nothing posted, the order still disputed.
    expect((await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص', faultParty: 'courier' })).pendingApprovalId).toBe(asked.pendingApprovalId);
    expect(h.events.ofType('order.dispute_resolved')).toHaveLength(0);
    expect(h.audits.at(-1)).toMatchObject({ action: 'order.refund_requested', actorId: 'ali' });
    const id = asked.pendingApprovalId!;
    await expect(h.approvals!.approve('ali', id)).rejects.toMatchObject({ code: 'approval_own_item' });
    expect(await h.approvals!.approve('fin_1', id)).toMatchObject({ state: 'approved', decidedBy: 'fin_1' });
    await expect(h.approvals!.approve('fin_2', id)).rejects.toMatchObject({ code: 'approval_state_conflict' });
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(5_000);
    expect((await h.repo.find(order.id))!.order).toMatchObject({ state: 'closed', refundState: 'credited' });
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ outcome: 'refund_partial', refundIqd: 5_000, funder: 'courier' });
    expect(h.audits.at(-1)).toMatchObject({ action: 'order.ops_resolve_dispute', actorId: 'fin_1' });
  });

  it('a second OK that can no longer post leaves the request pending; declined, he may ask again', async () => {
    const h = staffHarness({ disputes: { outcomes: [...DISPUTE_OUTCOMES], agentLimitIqd: 2_000 } }, { ledger: ledgerHarness(), approvals: true });
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'missing_item' });
    const first = (await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص', faultParty: 'platform' })).pendingApprovalId!;
    expect(await h.approvals!.decline('fin_1', first, 'نحچي ويا المطعم')).toMatchObject({ state: 'declined' });
    const again = (await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص', faultParty: 'platform' })).pendingApprovalId!;
    expect(again).not.toBe(first);
    // Meanwhile the complaint was settled another way: the approval fails and stays pending.
    await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'stands', reason: 'انحل ويا الزبون', faultParty: 'platform' });
    await expect(h.approvals!.approve('fin_1', again)).rejects.toMatchObject({ code: 'order_state_conflict' });
    expect(await h.approvals!.get(again)).toMatchObject({ state: 'pending' });
    expect(await h.approvals!.cancel('ops_1', again)).toMatchObject({ state: 'cancelled' });
  });

  it('refund_partial: never more than he paid less earlier refunds; above the agent limit only admin', async () => {
    const h = make({ disputes: { outcomes: [...DISPUTE_OUTCOMES], agentLimitIqd: 2_000 } });
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'missing_item' });
    expect(await code(h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: order.totalIqd + 250, reason: 'ناقص', faultParty: 'courier' }))).toBe('refund_exceeds_order');
    expect(await code(h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص', faultParty: 'courier' }))).toBe('refund_needs_escalation');
    const r = await h.staff.resolveDispute(ali, { orderId: order.id, outcome: 'refund_partial', amountIqd: 5_000, reason: 'ناقص صنف', faultParty: 'courier' });
    expect(r).toMatchObject({ state: 'closed', postedIqd: 5_000 });
    await h.settle();
    // cash paid at the door; 5,000 back to his wallet from the courier's earnings
    expect(await h.balance('customer:c1')).toBe(5_000);
    expect(await h.balance('driver:d1')).toBe(1_000 - 5_000);
    expect((await h.repo.find(order.id))!.order.refundState).toBe('credited');
  });

  it('a second dispute on the same order posts its own refund (one group per dispute episode)', async () => {
    const h = make(all);
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'missing_item' });
    expect(await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 2_000, reason: 'ناقص صنف', faultParty: 'platform' })).toMatchObject({ state: 'closed', postedIqd: 2_000 });
    // support reopens the closed order (closed → disputed)
    const closed = (await h.repo.find(order.id))!.order;
    await h.uow.run((tx) => h.orders.staffBridge().move(closed, 'disputed', 'ops_1', tx, {}, { kind: 'missing_item', openedBy: 'staff' }));
    const r = await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'refund_partial', amountIqd: 3_000, reason: 'ناقص صنف ثاني', faultParty: 'platform' });
    expect(r).toMatchObject({ state: 'closed', postedIqd: 3_000 });
    const refunds = (await h.ledger.eventsForOrder(order.id)).filter((e) => e.type === 'refund');
    expect(refunds.map((e) => e.amount)).toEqual([2_000, 3_000]);
    expect(new Set(refunds.map((e) => e.postingGroupId)).size).toBe(2);
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ refundIqd: 3_000, funder: 'platform' });
    expect(h.audits.at(-1)!.summaryAr).toContain('3,000');
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(5_000);
  });

  it('redelivery: closes with nothing posted and tells support to arrange it', async () => {
    const h = make(all);
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'wrong_item' });
    const r = await h.staff.resolveDispute(ops, { orderId: order.id, outcome: 'redelivery', reason: 'نرجع نوصل', faultParty: 'merchant' });
    expect(r).toMatchObject({ state: 'closed', postedIqd: 0 });
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ outcome: 'redelivery', redelivery: true });
  });

  it('void: an order that never reached him (unreachable at the door) ends with nothing charged; stands is refused there', async () => {
    const h = make(all);
    h.wallets.set('customer:c1', 100_000);
    const o = await h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet' }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: { lat: 32.9185, lng: 45.0712 } });
    await h.trips.startUnreachable(t.id, drop.id, 'd1');
    await h.advance(5 * MIN);
    await h.trips.fail(t.id, { personId: 'd1', role: 'driver' } as never);
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('disputed');
    expect(await code(h.staff.resolveDispute(ops, { orderId: o.id, outcome: 'stands', reason: 'x x', faultParty: 'platform' }))).toBe('order_state_conflict');
    const r = await h.staff.resolveDispute(ops, { orderId: o.id, outcome: 'void', reason: 'ما جاوب', faultParty: 'platform' });
    expect(r.state).toBe('refunded');
    expect(await h.orders.openWalletHoldIqd('c1')).toBe(0);
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(0);
  });

  it('deadline watchdog (switch on): escalates at 48 h once, lets it stand at 72 h with a push; off = nothing', async () => {
    const off = make(all);
    const a = await off.delivered();
    await off.orders.openDispute('c1', { orderId: a.order.id, kind: 'cold_or_late' });
    off.clock.advance(80 * HOUR);
    expect(await off.staff.sweep()).toBe(0);

    const h = make({ disputes: { outcomes: [], auto: { enabled: true, escalateAfterH: 48, standsAfterH: 72 } } });
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'cold_or_late' });
    h.clock.advance(49 * HOUR);
    expect(await h.staff.sweep()).toBe(1);
    expect(await h.staff.sweep()).toBe(0);
    expect(h.events.ofType('order.dispute_escalated')).toHaveLength(1);
    h.clock.advance(24 * HOUR);
    expect(await h.staff.sweep()).toBe(1);
    expect((await h.orders.get(order.id)).state).toBe('closed');
    expect(h.events.last('order.dispute_resolved')!.payload).toMatchObject({ outcome: 'stands', auto: true });
    expect(h.audits.map((x) => x.action)).toEqual(['order.dispute_escalated', 'order.ops_resolve_dispute']);
  });
});

describe('platform failure (NTF-11, M-2)', () => {
  async function silentKitchen(h: ReturnType<typeof make>) {
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    h.clock.advance(30 * MIN); // promised + 15, no heartbeat at all
    return o;
  }

  it('off: the normal fee stands (food cost after preparing)', async () => {
    const h = make();
    const o = await silentKitchen(h);
    expect(await h.orders.cancellationPreview(o.id)).toMatchObject({ free: false, amountIqd: 15_000 });
  });

  it('on: the kitchen gone silent → free cancel, the platform pays the cooked food (payer platform) or nobody (payer merchant)', async () => {
    for (const payer of ['platform', 'merchant'] as const) {
      const h = make({ platformFailure: { freeCancel: true, cookedFoodPayer: payer } });
      const o = await silentKitchen(h);
      expect(await h.orders.cancellationPreview(o.id)).toMatchObject({ free: true, amountIqd: 0 });
      expect((await h.staff.stuck({ cityId: 'aziziyah', limit: 50 })).find((s) => s.orderId === o.id)).toMatchObject({ reason: 'kitchen_silent', platformFailure: true, actions: ['cancel'] });
      expect(await h.staff.sweep()).toBe(1);
      expect(await h.staff.sweep()).toBe(0);
      expect(h.events.last('order.free_cancel_offered')!.payload).toMatchObject({ customerId: 'c1', failure: 'kitchen_silent' });
      await h.orders.cancel('c1', { orderId: o.id });
      await h.settle();
      expect(await h.balance('customer:c1')).toBe(0);
      expect(await h.balance('merchant_cash:rest_1')).toBe(payer === 'platform' ? 15_000 : 0);
      await h.staff.onOrderCancelled(h.events.last('order.cancelled')!.payload);
      expect(await h.balance('merchant_cash:rest_1')).toBe(payer === 'platform' ? 15_000 : 0);
    }
  });

  it('a kitchen that is still there (fresh heartbeat) is not a failure', async () => {
    const h = make({ platformFailure: { freeCancel: true } });
    const o = await silentKitchen(h);
    await h.orders.merchantHeartbeat('rest_1');
    expect(await h.orders.cancellationPreview(o.id)).toMatchObject({ free: false });
  });

  it('ready food with no courier for 15 minutes is a failure', async () => {
    const h = make({ platformFailure: { freeCancel: true } });
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markReady('m1', { orderId: o.id });
    h.clock.advance(10 * MIN);
    expect((await h.orders.cancellationPreview(o.id)).free).toBe(false);
    h.clock.advance(6 * MIN);
    expect((await h.orders.cancellationPreview(o.id)).free).toBe(true);
  });
});

describe('courier lost (NTF-13, M-10)', () => {
  async function onTheWay(h: ReturnType<typeof make>, wallet = false) {
    if (wallet) h.wallets.set('customer:c1', 100_000);
    const o = await h.orders.place('c1', h.foodInput(wallet ? { paymentMethod: 'wallet' } : {}));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    return o;
  }

  it('off: the order becomes a courier_lost dispute, never re-dispatched; the charge is refused', async () => {
    const h = make();
    const o = await onTheWay(h);
    h.clock.advance(70 * MIN);
    expect((await h.staff.stuck({ cityId: 'aziziyah', limit: 10 }))[0]).toMatchObject({ orderId: o.id, reason: 'courier_lost', actions: ['markDelivered', 'courierLost'] });
    const r = await h.staff.courierLost(ops, { orderId: o.id, reason: 'الدليفري ما يرد' });
    expect(r).toMatchObject({ state: 'disputed', postedIqd: 0 });
    expect(h.events.last('order.disputed')!.payload).toMatchObject({ kind: 'courier_lost', defaultOutcome: 'courier_pays_food_cost', courierId: 'd1' });
    expect(h.events.ofType('order.courier_unassigned')).toHaveLength(0);
    expect(await code(h.staff.chargeCourier(ops, { orderId: o.id, reason: 'تأكدنا' }))).toBe('money_rule_off');
    expect(await h.staff.courierLost(ops, { orderId: o.id, reason: 'مرة ثانية' })).toMatchObject({ changed: false });
    // The staff's free text stays in the audit row only.
    expect(JSON.stringify(h.events.events)).not.toContain('الدليفري ما يرد');
    expect(h.audits[0]!.summaryAr).toContain('الدليفري ما يرد');
  });

  it('off: void still ends the courier_lost dispute (it moves no money, so it needs no switch); other outcomes stay refused', async () => {
    const h = make();
    const o = await onTheWay(h, true);
    await h.staff.courierLost(ops, { orderId: o.id, reason: 'الدليفري ما يرد' });
    expect(await code(h.staff.resolveDispute(ops, { orderId: o.id, outcome: 'refund_full', reason: 'x x x', faultParty: 'courier' }))).toBe('money_rule_off');
    const r = await h.staff.resolveDispute(ops, { orderId: o.id, outcome: 'void', reason: 'الطلب ما وصل', faultParty: 'courier' });
    expect(r).toMatchObject({ state: 'refunded', changed: true, postedIqd: 0 });
    expect(await h.orders.openWalletHoldIqd('c1')).toBe(0);
    await h.settle();
    expect(await h.balance('customer:c1')).toBe(0);
    expect((await h.ledger.eventsForOrder(o.id))).toEqual([]);
  });

  it('the charge needs the platform to have paid the kitchen (refund switch on, order refunded)', async () => {
    // charge on, refund off: the order sits in the dispute and the platform paid nothing
    const h = make({ courierLost: { refund: false, chargeCourier: true } });
    const o = await onTheWay(h);
    await h.staff.courierLost(ops, { orderId: o.id, reason: 'اختفى' });
    expect(await code(h.staff.chargeCourier(ali, { orderId: o.id, reason: 'تأكدنا' }))).toBe('order_state_conflict');
    // ended by void afterwards: still no kitchen payment, still no charge
    await h.staff.resolveDispute(ops, { orderId: o.id, outcome: 'void', reason: 'ما وصل', faultParty: 'courier' });
    expect(await code(h.staff.chargeCourier(ali, { orderId: o.id, reason: 'تأكدنا' }))).toBe('order_state_conflict');
    expect(await h.balance('cash:d1')).toBe(0);
  });

  it('on: ends at once with nothing charged, the kitchen paid by the platform, and (second switch) the courier charged once', async () => {
    const h = make({ courierLost: { refund: true, chargeCourier: true } });
    const o = await onTheWay(h, true);
    const r = await h.staff.courierLost(ops, { orderId: o.id, reason: 'اختفى' });
    expect(r).toMatchObject({ state: 'refunded', postedIqd: 15_000 });
    expect(await h.orders.openWalletHoldIqd('c1')).toBe(0);
    expect(h.events.last('order.courier_lost')!.payload).toMatchObject({ customerId: 'c1', kitchenPaidIqd: 15_000 });
    const c = await h.staff.chargeCourier(ali, { orderId: o.id, reason: 'تأكدنا منه' });
    expect(c.postedIqd).toBe(15_000);
    expect(await h.balance('cash:d1')).toBe(-15_000);
    expect((await h.staff.chargeCourier(ali, { orderId: o.id, reason: 'مرة ثانية' })).changed).toBe(false);
    expect(await h.balance('platform')).toBe(0);
    expect((await h.ledger.checkInvariant()).ok).toBe(true);
  });
});

describe('stuck list', () => {
  it('watchdog: an order stuck again against the same since is recorded again (episode in the key)', async () => {
    const h = make();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    h.clock.advance(30 * MIN); // silent kitchen, past its promised time
    expect(await h.staff.watchStuck()).toBe(1);
    await h.orders.merchantHeartbeat('rest_1');
    expect(await h.staff.watchStuck()).toBe(1); // unstuck
    h.clock.advance(10 * MIN); // the heartbeat goes stale again: same promisedReadyAt
    expect(await h.staff.watchStuck()).toBe(1);
    expect(await h.staff.watchStuck()).toBe(0);
    const marks = h.events.events.filter((e) => e.orderId === o.id && (e.type === 'order.stuck' || e.type === 'order.unstuck'));
    expect(marks.map((e) => e.type)).toEqual(['order.stuck', 'order.unstuck', 'order.stuck']);
    expect(marks[0]!.payload['since']).toEqual(marks[2]!.payload['since']);
  });

  it('lists orders past their state deadline, oldest first; fresh ones are not stuck', async () => {
    const h = make();
    const a = await h.orders.place('c1', h.foodInput());
    h.clock.advance(2 * MIN);
    expect(await h.staff.stuck({ cityId: 'aziziyah', limit: 10 })).toEqual([]);
    h.clock.advance(4 * MIN);
    const { order } = await h.delivered();
    await h.orders.openDispute('c1', { orderId: order.id, kind: 'cold_or_late' });
    const list = await h.staff.stuck({ cityId: 'aziziyah', limit: 10 });
    expect(list.map((s) => [s.orderId, s.reason])).toEqual([
      [a.id, 'merchant_no_answer'],
      [order.id, 'dispute_open'],
    ]);
    h.clock.advance(25 * HOUR);
    expect((await h.staff.stuck({ cityId: 'aziziyah', limit: 10 })).find((s) => s.orderId === order.id)!.reason).toBe('dispute_overdue');
  });
});

describe('remake pay (c6, Ali 2026-10-08)', () => {
  async function readyAndWaiting(h: ReturnType<typeof make>) {
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    await h.orders.markReady('m1', { orderId: o.id });
    const t = await h.tripFor(o.id);
    return { o: await h.orders.get(o.id), t };
  }

  it('on by default (Ali 2026-10-08); MERCHANT_REMAKE_PAY=off switches it off and refuses with money_rule_off', async () => {
    expect(outcomeRulesFromEnv({}).remake).toEqual({ pay: true, afterReadyMin: 10 });
    expect(outcomeRulesFromEnv({ MERCHANT_REMAKE_PAY: 'off' }).remake.pay).toBe(false);
    const h = make({ remake: { pay: false } });
    const { o } = await readyAndWaiting(h);
    expect(h.staff.remakeRule()).toEqual({ pay: false, afterReadyMin: 10 });
    h.clock.advance(11 * MIN);
    expect(await code(h.staff.merchantRemake('m1', { orderId: o.id }))).toBe('money_rule_off');
    expect(await h.balance('merchant_cash:rest_1')).toBe(0);
    expect(make().staff.remakeRule()).toEqual({ pay: true, afterReadyMin: 10 });
  });

  it('on: from 10 minutes after «جاهز» with no courier at the pass, Driver pays the items at menu price, once', async () => {
    const h = make({ remake: { pay: true } });
    const { o } = await readyAndWaiting(h);
    h.clock.advance(9 * MIN);
    expect(await code(h.staff.merchantRemake('m1', { orderId: o.id }))).toBe('order_state_conflict');
    h.clock.advance(1 * MIN);
    expect(await h.staff.merchantRemake('m1', { orderId: o.id })).toEqual({ orderId: o.id, paidIqd: o.itemsTotalIqd, alreadyPaid: false });
    expect(await h.balance('merchant_cash:rest_1')).toBe(o.itemsTotalIqd);
    expect(h.events.last('order.remake_paid')!.payload).toMatchObject({ merchantOrgId: 'rest_1', paidIqd: o.itemsTotalIqd });
    expect(await h.staff.merchantRemake('m1', { orderId: o.id })).toEqual({ orderId: o.id, paidIqd: 0, alreadyPaid: true });
    expect(await h.balance('merchant_cash:rest_1')).toBe(o.itemsTotalIqd);
    // The order stays ready for the courier who comes.
    expect((await h.orders.get(o.id)).state).toBe('ready');
  });

  it('on: refused once the courier is at the pass, and before the food was marked ready', async () => {
    const h = make({ remake: { pay: true } });
    const { o, t } = await readyAndWaiting(h);
    h.clock.advance(12 * MIN);
    const stop = t.stops.find((s) => s.type === 'pickup')!;
    await h.trips.arrive(t.id, stop.id, 'd1', { pin: stop.target! });
    expect(await code(h.staff.merchantRemake('m1', { orderId: o.id }))).toBe('order_state_conflict');
    const other = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: other.id, prepMinutes: 15 });
    h.clock.advance(30 * MIN);
    expect(await code(h.staff.merchantRemake('m1', { orderId: other.id }))).toBe('order_state_conflict');
  });
});
