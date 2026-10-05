import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { byTimeLeft, canExtendPrep, cardTiming, clampPrep, committedPrep, courierLine, defaultPrepChoice, hasAllergy, isLongOrder, isRush, kitchenNotes, newCount, newOrderSummary, oneTapPrep, partialValid, rejectReasonValue, splitColumns, stickyAcceptTarget, suggestBusy, unacknowledged } from './logic';

const T0 = Date.parse('2026-10-03T17:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const courier = { state: 'none' as const, firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null };

function card(id: string, patch: Partial<BoardOrder> = {}): BoardOrder {
  return {
    id,
    number: '1000',
    column: 'new',
    state: 'placed',
    type: 'food',
    placedAt: at(0),
    offeredAt: at(0),
    acceptBy: at(1.5),
    acceptedAt: null,
    promisedReadyAt: null,
    readyAt: null,
    scheduledFor: null,
    prepMinutes: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 10000,
    totalIqd: 11500,
    collectCashIqd: 11500,
    itemCount: 2,
    groups: [],
    note: null,
    partial: null,
    courier,
    late: false,
    catering: false,
    ...patch,
  };
}

describe('board logic', () => {
  it('splits orders into the three columns', () => {
    const cols = splitColumns([card('a'), card('b', { column: 'ready' }), card('c', { column: 'preparing' }), card('d')]);
    expect(cols.new.map((o) => o.id)).toEqual(['a', 'd']);
    expect(cols.preparing.map((o) => o.id)).toEqual(['c']);
    expect(cols.ready.map((o) => o.id)).toEqual(['b']);
  });

  it('prep choices: nearest option (ties up), clamped custom, +10 while busy', () => {
    expect(defaultPrepChoice(20)).toBe(25);
    expect(defaultPrepChoice(12)).toBe(10);
    expect(defaultPrepChoice(14)).toBe(15);
    expect(defaultPrepChoice(40)).toBe(25);
    expect(clampPrep(2)).toBe(5);
    expect(clampPrep(500)).toBe(120);
    expect(committedPrep(15, true)).toBe(25);
    expect(committedPrep(15, false)).toBe(15);
  });

  it('card timing: waiting, ready-in, late, ready-since', () => {
    expect(cardTiming(card('a'), T0 + 4.5 * 60_000)).toEqual({ kind: 'since', minutes: 4 });
    expect(cardTiming(card('a', { column: 'preparing', promisedReadyAt: at(20) }), T0 + 5 * 60_000 + 1)).toEqual({ kind: 'ready_in', minutes: 15 });
    expect(cardTiming(card('a', { column: 'preparing', promisedReadyAt: at(20) }), T0 + 23 * 60_000)).toEqual({ kind: 'late', minutes: 3 });
    expect(cardTiming(card('a', { column: 'ready', readyAt: at(2) }), T0 + 9 * 60_000)).toEqual({ kind: 'ready_since', minutes: 7 });
  });

  it('courier line: searching, on the way with name and minutes, arrived, waiting turns warning', () => {
    expect(courierLine(courier, T0)).toBeNull();
    expect(courierLine({ ...courier, state: 'searching' }, T0)).toMatchObject({ key: 'merchant.courier.searching', tone: 'neutral' });
    expect(courierLine({ ...courier, state: 'on_the_way', etaMinutes: 4 }, T0)).toEqual({ key: 'merchant.courier.on_the_way', params: { minutes: 4 }, tone: 'info', live: true });
    expect(courierLine({ ...courier, state: 'on_the_way', etaMinutes: 4, firstName: 'حيدر' }, T0)).toMatchObject({ key: 'merchant.courier.on_the_way_named', params: { name: 'حيدر', minutes: 4 } });
    expect(courierLine({ ...courier, state: 'arrived', arrivedAt: at(-1) }, T0)).toMatchObject({ key: 'merchant.courier.arrived', tone: 'success' });
    expect(courierLine({ ...courier, state: 'arrived', arrivedAt: at(-6) }, T0)).toMatchObject({ key: 'merchant.courier.arrived_waiting', params: { minutes: 6 }, tone: 'warning' });
  });

  it('only new, un-silenced orders without a pending partial keep ringing', () => {
    const orders = [card('a'), card('b'), card('c', { column: 'preparing' }), card('d', { partial: { unavailableLineIds: ['x'], deadline: at(1) } })];
    expect(unacknowledged(orders, new Set(['b']))).toEqual(['a']);
  });

  it('reject reasons: codes, and "other" needs words', () => {
    expect(rejectReasonValue('sold_out', '')).toBe('sold_out');
    expect(rejectReasonValue('other', '   ')).toBeNull();
    expect(rejectReasonValue('other', ' الفرن عاطل ')).toBe('other: الفرن عاطل');
  });

  it('partial accept leaves something to cook', () => {
    expect(partialValid(new Set(['l1']), ['l1', 'l2'])).toBe(true);
    expect(partialValid(new Set(), ['l1', 'l2'])).toBe(false);
    expect(partialValid(new Set(['l1', 'l2']), ['l1', 'l2'])).toBe(false);
    expect(partialValid(new Set(['zz']), ['l1', 'l2'])).toBe(false);
  });

  it('one tap accepts with the usual prep time; busy adds 10 to what the customer sees (M-12)', () => {
    expect(oneTapPrep(15, false)).toEqual({ prepMinutes: 15, shown: 15 });
    // The server adds the busy minutes itself: we send the usual time and show the committed one.
    expect(oneTapPrep(15, true)).toEqual({ prepMinutes: 15, shown: 25 });
    expect(oneTapPrep(2, false)).toEqual({ prepMinutes: 5, shown: 5 });
    expect(oneTapPrep(17.6, false)).toEqual({ prepMinutes: 18, shown: 18 });
  });

  it('"+5 د" once, only on an accepted order still being prepared', () => {
    expect(canExtendPrep(card('a', { column: 'preparing', promisedReadyAt: at(10) }))).toBe(true);
    expect(canExtendPrep(card('a', { column: 'preparing', promisedReadyAt: at(10), prepExtended: false }))).toBe(true);
    expect(canExtendPrep(card('a', { column: 'preparing', promisedReadyAt: at(10), prepExtended: true }))).toBe(false);
    expect(canExtendPrep(card('a', { column: 'new' }))).toBe(false);
    expect(canExtendPrep(card('a', { column: 'ready', promisedReadyAt: at(10) }))).toBe(false);
    expect(canExtendPrep(card('a', { column: 'preparing', promisedReadyAt: null }))).toBe(false);
  });
});

const line = (note: string | null = null) => ({ lineId: 'l', name: 'تكة', qty: 1, modifiers: [], note, unitPriceIqd: 1000, totalIqd: 1000, availability: 'available' as const });
const group = (key: string, kind: 'orderer' | 'participant', note: string | null = null, lines = [line()]) => ({ key, kind, label: kind === 'orderer' ? null : 'منار', note, itemCount: lines.length, lines });

describe('rush: one count, answer order, compact tickets, sticky accept (M-05, M-06, M-10)', () => {
  it('one "new" number everywhere, and the banner states snoozed and waiting-for-customer apart', () => {
    const orders = [card('a'), card('b'), card('c', { partial: { unavailableLineIds: ['x'], deadline: at(1) } }), card('d', { column: 'preparing' })];
    expect(newCount(orders)).toBe(3);
    expect(newOrderSummary(orders, ['b', 'd'])).toEqual({ total: 3, snoozed: 1, withCustomer: 1 });
    expect(newOrderSummary([], [])).toEqual({ total: 0, snoozed: 0, withCustomer: 0 });
  });

  it('orders the جديد column by time left; no running clock goes last, oldest first', () => {
    const sorted = byTimeLeft([
      card('late-arrival', { placedAt: at(1), acceptBy: at(2.5) }),
      card('partial', { placedAt: at(-5), acceptBy: at(0.2), partial: { unavailableLineIds: ['x'], deadline: at(1) } }),
      card('urgent', { placedAt: at(0.5), acceptBy: at(0.6) }),
      card('scheduled', { placedAt: at(-30), acceptBy: null }),
      card('mid', { placedAt: at(0), acceptBy: at(1.5) }),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['urgent', 'mid', 'late-arrival', 'scheduled', 'partial']);
  });

  it('rush from three waiting; busy suggested from four unless busy is on', () => {
    expect([0, 2, 3, 8].map(isRush)).toEqual([false, false, true, true]);
    expect(suggestBusy(3, false)).toBe(false);
    expect(suggestBusy(4, false)).toBe(true);
    expect(suggestBusy(9, true)).toBe(false);
  });

  it('sticky accept bar: the next order when it is long or a group, or whenever several wait', () => {
    const short = card('short', { itemCount: 2, groups: [group('o', 'orderer')] });
    const grouped = card('group', { itemCount: 3, acceptBy: at(1), groups: [group('o', 'orderer'), group('p', 'participant')] });
    const long = card('long', { itemCount: 5, groups: [group('o', 'orderer')] });
    expect(isLongOrder(short)).toBe(false);
    expect(isLongOrder(grouped)).toBe(true);
    expect(isLongOrder(long)).toBe(true);
    expect(stickyAcceptTarget([short])).toBeNull();
    expect(stickyAcceptTarget([long])?.id).toBe('long');
    // Two waiting: the one with less time left, even if short.
    expect(stickyAcceptTarget([short, grouped])?.id).toBe('group');
    expect(stickyAcceptTarget([short, card('later', { acceptBy: at(3) })])?.id).toBe('short');
    // Partial accepts wait for the customer, not the kitchen; other columns never.
    expect(stickyAcceptTarget([card('p', { itemCount: 9, partial: { unavailableLineIds: ['x'], deadline: at(1) } }), card('q', { column: 'preparing', itemCount: 9 })])).toBeNull();
  });

  it('allergy pill: any kitchen note on the order — order, person or line (M-09)', () => {
    expect(hasAllergy(card('a', { note: 'بدون بصل', groups: [group('o', 'orderer', null, [line('حار')])] }))).toBe(false);
    expect(hasAllergy(card('a', { note: 'منار عندها حساسية من الفستق' }))).toBe(true);
    expect(hasAllergy(card('a', { groups: [group('p', 'participant', 'حساس من الطماطة')] }))).toBe(true);
    expect(hasAllergy(card('a', { groups: [group('o', 'orderer', null, [line('nut allergy')])] }))).toBe(true);
    // The courier's note is not the kitchen's: never read for the pill.
    expect(hasAllergy(card('a', { courierNote: 'الجار عنده حساسية من الجرس' }))).toBe(false);
    expect(kitchenNotes(card('a', { note: 'أ', groups: [group('p', 'participant', 'ب', [line('ج')])] }))).toEqual(['أ', 'ب', 'ج']);
  });
});
