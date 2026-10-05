import type { OrderLedgerLine, OrderState, OrderSummary } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { at, order } from './fixtures';
import { dispatchSummary, EMPTY_FILTER, listInput, moneyLines, ORDER_PHASE, ORDER_STATE_TONE, orderStory, partyOf, sortSummaries, storyTotalMin } from './orders';

const NOW = new Date('2026-10-04T19:30:00Z'); // 22:30 Baghdad

describe('saved views and filters → orders.search', () => {
  it('today by default; views pick states; filters pass through', () => {
    expect(listInput('aziziyah', EMPTY_FILTER, NOW, false)).toEqual({ cityId: 'aziziyah', limit: 50, from: new Date('2026-10-03T21:00:00Z') });
    const active = listInput('aziziyah', { ...EMPTY_FILTER, view: 'active', payment: 'cash', zoneKey: 'zakur', merchantOrgId: 'org_1', type: 'food' }, NOW, false);
    expect(active).toMatchObject({ states: ['placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up', 'matched'], paymentMethod: 'cash', zoneKey: 'zakur', merchantOrgId: 'org_1', type: 'food' });
    expect(listInput('aziziyah', { ...EMPTY_FILTER, view: 'disputes' }, NOW, false).states).toEqual(['disputed', 'refunded']);
  });

  it('the late view and an order number ignore the period', () => {
    const late = listInput('aziziyah', { ...EMPTY_FILTER, view: 'late', period: { preset: 'yesterday' } }, NOW, false);
    expect(late).toEqual({ cityId: 'aziziyah', limit: 50, late: true });
    const ticket = listInput('aziziyah', { ...EMPTY_FILTER, q: '#1284' }, NOW, true);
    expect(ticket).toEqual({ cityId: 'aziziyah', limit: 50, text: '#1284' });
  });

  it('sorts the latest first on demand, newest after them', () => {
    const s = (id: string, lateMin: number | null, min: number) => ({ id, lateMin, placedAt: at(min) }) as OrderSummary;
    const rows = [s('a', null, 9), s('b', 12, 1), s('c', 30, 0), s('d', null, 5)];
    expect(sortSummaries(rows, 'late').map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(sortSummaries(rows, 'newest').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('every state has a stage (icon) and a tone', () => {
    for (const st of Object.keys(ORDER_STATE_TONE) as OrderState[]) expect(ORDER_PHASE[st]).toBeTruthy();
    expect(ORDER_PHASE.preparing).toBe('kitchen');
    expect(ORDER_PHASE.picked_up).toBe('road');
    expect(ORDER_PHASE.disputed).toBe('problem');
  });
});

describe('the order told as a story (K-22)', () => {
  it('four moments with the minutes between them and the time to the door', () => {
    const steps = orderStory(order({ id: 'o', placedAt: at(0), acceptedAt: at(1), pickedUpAt: at(23), deliveredAt: at(44) }));
    expect(steps.map((s) => [s.key, s.sinceMin])).toEqual([
      ['placed', null],
      ['accepted', 1],
      ['picked_up', 22],
      ['delivered', 21],
    ]);
    expect(storyTotalMin(steps)).toBe(44);
  });

  it('an open order ends on what it waits for; a ride skips the kitchen; a cancellation ends it', () => {
    const open = orderStory(order({ id: 'o', placedAt: at(0), acceptedAt: at(2) }));
    expect(open.map((s) => [s.key, s.at === null])).toEqual([
      ['placed', false],
      ['accepted', false],
      ['picked_up', true],
    ]);
    expect(storyTotalMin(open)).toBeNull();
    expect(orderStory(order({ id: 'r', type: 'ride', merchantOrgId: null, placedAt: at(0) })).map((s) => s.key)).toEqual(['placed', 'picked_up']);
    const cancelled = orderStory(order({ id: 'c', placedAt: at(0), cancelledAt: at(6) }));
    expect(cancelled.map((s) => s.key)).toEqual(['placed', 'cancelled']);
    expect(storyTotalMin(cancelled)).toBe(6);
  });

  it('folds the dispatch noise into one line', () => {
    const e = (type: string, min: number, actorId = 'system') => ({ type, at: at(min), actorId });
    expect(dispatchSummary([e('order.placed', 0)])).toBeNull();
    const s = dispatchSummary([e('dispatch.requested', 10), e('dispatch.offer_sent', 10), e('dispatch.offer_timed_out', 10.5), e('dispatch.offer_sent', 10.5), e('trip.accepted', 11, 'p_haider')]);
    expect(s).toEqual({ offered: 2, missed: 1, acceptedBy: 'p_haider', acceptedAfterSec: 60, manual: false });
  });
});

describe('money in words (K-16)', () => {
  const l = (type: string, fromAccount: string, toAccount: string, amountIqd: number): OrderLedgerLine => ({ id: type, at: at(0), type, label_ar: type, amountIqd, fromAccount, toAccount, memo: null });
  it('says where each posting ends up, never with a sign, and leaves points out', () => {
    expect(partyOf('merchant_cash:org_1')).toBe('merchant');
    expect(partyOf('cash:p_1')).toBe('courier_cash');
    expect(partyOf('driver:p_1')).toBe('courier');
    const heads = moneyLines([
      l('merchant_payable', 'platform', 'merchant_cash:org_1', 1500),
      l('commission_accrued', 'merchant_cash:org_1', 'platform', 180),
      l('delivery_fee_earned', 'platform', 'driver:p_1', 750),
      l('cash_collected', 'cash:p_1', 'customer:c_1', 2750),
      l('points_earned', 'platform', 'customer:c_1', 27),
      l('refund_credit', 'platform', 'customer:c_1', 500),
    ]).map((m) => [m.head, m.amountIqd]);
    expect(heads).toEqual([
      ['to_merchant', 1500],
      ['commission', 180],
      ['to_courier', 750],
      ['on_courier', 2750],
      ['to_customer', 500],
    ]);
  });
});
