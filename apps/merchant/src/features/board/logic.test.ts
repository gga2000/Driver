import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { busyExtra, prepOptions, byDueFirst, byTimeLeft, cookingTotals, dishLine, prepLeft, tickKey, canExtendPrep, cardTiming, clampPrep, committedPrep, courierLine, defaultPrepChoice, hasAllergy, isLongOrder, isRush, kitchenNotes, newCount, newOrderSummary, oneTapPrep, partialValid, rejectReasonValue, splitColumns, phoneNow, suggestBusy, unacknowledged, rushRows, acceptAllTargets, needsReading, dishesOut } from './logic';

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
    expect(committedPrep(15, 10)).toBe(25);
    expect(committedPrep(15, 20)).toBe(35);
    expect(committedPrep(15, 0)).toBe(15);
  });

  it('t5: a juice bar or café picks 3 / 5 / 8; food (and a shop with both) keeps 10 / 15 / 25', () => {
    expect(prepOptions('drinks')).toEqual([3, 5, 8]);
    expect(prepOptions('food')).toEqual([10, 15, 25]);
    expect(prepOptions(undefined)).toEqual([10, 15, 25]);
    expect(defaultPrepChoice(5, 'drinks')).toBe(5);
    expect(defaultPrepChoice(20, 'drinks')).toBe(8);
    expect(defaultPrepChoice(4, 'drinks')).toBe(5);
    expect(clampPrep(2, 'drinks')).toBe(2);
    expect(clampPrep(0, 'drinks')).toBe(1);
    expect(clampPrep(2, 'food')).toBe(5);
    expect(oneTapPrep(5, 0, 'drinks')).toEqual({ prepMinutes: 5, shown: 5 });
  });

  it('r5: the busy minutes in force are the ones picked (+10 or +20), none when off', () => {
    expect(busyExtra({ busy: { on: true, until: new Date(T0), extraPrepMinutes: 20 } })).toBe(20);
    expect(busyExtra({ busy: { on: true, until: new Date(T0), extraPrepMinutes: 10 } })).toBe(10);
    expect(busyExtra({ busy: { on: false, until: null, extraPrepMinutes: 0 } })).toBe(0);
    expect(busyExtra(undefined)).toBe(0);
    expect(oneTapPrep(15, 20)).toEqual({ prepMinutes: 15, shown: 35 });
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
    expect(courierLine({ ...courier, state: 'on_the_way', etaMinutes: 4 }, T0)).toEqual({ key: 'merchant.courier.on_the_way', params: { minutes: 4 }, tone: 'neutral', live: true });
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
    expect(oneTapPrep(15, 0)).toEqual({ prepMinutes: 15, shown: 15 });
    // The server adds the busy minutes itself: we send the usual time and show the committed one.
    expect(oneTapPrep(15, 10)).toEqual({ prepMinutes: 15, shown: 25 });
    expect(oneTapPrep(2, 0)).toEqual({ prepMinutes: 5, shown: 5 });
    expect(oneTapPrep(17.6, 0)).toEqual({ prepMinutes: 18, shown: 18 });
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

  it('rush from three waiting; one-line rows from seven (r2); busy suggested from six unless busy is on (r4)', () => {
    expect([0, 2, 3, 8].map(isRush)).toEqual([false, false, true, true]);
    expect([3, 6, 7, 12].map(rushRows)).toEqual([false, false, true, true]);
    expect(suggestBusy(5, false)).toBe(false);
    expect(suggestBusy(6, false)).toBe(true);
    expect(suggestBusy(9, true)).toBe(false);
  });

  it('accept all (t4): busy mode only, from two plain orders; allergies, notes and partials are opened one by one', () => {
    const plain = (id: string) => card(id, { note: null, groups: [group('o', 'orderer')] });
    const noted = card('noted', { note: 'بدون بصل', groups: [group('o', 'orderer')] });
    const allergic = card('allergic', { note: null, groups: [group('o', 'orderer', 'حساسية فول سوداني')] });
    const partial = card('partial', { note: null, groups: [group('o', 'orderer')], partial: { unavailableLineIds: ['x'], deadline: at(1) } });
    const cooking = card('cooking', { column: 'preparing', note: null, groups: [group('o', 'orderer')] });
    const orders = [plain('a'), plain('b'), noted, allergic, partial, cooking, plain('closed')];
    const waiting = ['a', 'b', 'noted', 'allergic', 'partial', 'cooking'];
    expect(needsReading(noted)).toBe(true);
    expect(needsReading(allergic)).toBe(true);
    expect(needsReading(plain('x'))).toBe(false);
    const r = acceptAllTargets(orders, waiting, true);
    expect(r.targets.map((o) => o.id)).toEqual(['a', 'b']);
    expect(r.skipped).toBe(2);
    expect(acceptAllTargets(orders, waiting, false)).toEqual({ targets: [], skipped: 0 });
    expect(acceptAllTargets([plain('a'), noted], ['a', 'noted'], true)).toEqual({ targets: [], skipped: 0 });
  });

  it('phone «هسة»: the picked or most urgent order on top, the rest as rows; sticky only for a long one', () => {
    const short = card('short', { itemCount: 2, acceptBy: at(2), groups: [group('o', 'orderer')] });
    const grouped = card('group', { itemCount: 3, acceptBy: at(1), groups: [group('o', 'orderer'), group('p', 'participant')] });
    const long = card('long', { itemCount: 5, acceptBy: at(3), groups: [group('o', 'orderer')] });
    expect(isLongOrder(short)).toBe(false);
    expect(isLongOrder(grouped)).toBe(true);
    expect(isLongOrder(long)).toBe(true);
    const now = phoneNow([short, long, grouped, card('q', { column: 'preparing' })], null);
    expect(now.first?.id).toBe('group');
    expect(now.rest.map((o) => o.id)).toEqual(['short', 'long']);
    expect(now.sticky?.id).toBe('group');
    const picked = phoneNow([short, long, grouped], 'short');
    expect(picked.first?.id).toBe('short');
    expect(picked.rest.map((o) => o.id)).toEqual(['group', 'long']);
    expect(picked.sticky).toBeNull();
    // A partial accept waits for the customer, not the kitchen: no sticky accept.
    expect(phoneNow([card('p', { itemCount: 9, partial: { unavailableLineIds: ['x'], deadline: at(1) } })], null).sticky).toBeNull();
    expect(phoneNow([], null)).toEqual({ first: null, rest: [], sticky: null });
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

describe('counter board (redesign step 2)', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 7, 12, m));
  const line = (lineId: string, name: string, qty: number, availability: 'available' | 'unavailable' | 'removed' = 'available') => ({ lineId, name, qty, modifiers: [], note: null, unitPriceIqd: 1000, totalIqd: 1000 * qty, availability });
  const group = (lines: ReturnType<typeof line>[]) => ({ key: 'g', kind: 'orderer' as const, label: null, note: null, itemCount: lines.length, lines });

  it('puts the ticket due first at the top of «على النار»', () => {
    const list = [
      { id: 'a', placedAt: at(0), promisedReadyAt: at(30) },
      { id: 'b', placedAt: at(1), promisedReadyAt: at(10) },
      { id: 'c', placedAt: at(2), promisedReadyAt: null },
    ];
    expect(byDueFirst(list).map((o) => o.id)).toEqual(['b', 'a', 'c']);
  });

  it('drains the prep bar and says when it is late', () => {
    const o = { column: 'preparing' as const, acceptedAt: at(0), promisedReadyAt: at(20) };
    expect(prepLeft(o, at(5).getTime())).toEqual({ fraction: 0.75, late: false });
    expect(prepLeft(o, at(25).getTime())).toEqual({ fraction: 0, late: true });
    expect(prepLeft({ ...o, column: 'ready' }, at(5).getTime())).toBeNull();
    expect(prepLeft({ ...o, acceptedAt: null }, at(5).getTime())).toBeNull();
  });

  it('adds up what is cooking, skipping ticked, out and removed lines', () => {
    const orders = [
      { id: 'o1', column: 'preparing' as const, groups: [group([line('l1', 'تكة', 2), line('l2', 'لفة كص', 1)])] },
      { id: 'o2', column: 'preparing' as const, groups: [group([line('l3', 'تكة', 3), line('l4', 'ماي', 2, 'unavailable'), line('l5', 'كبة', 1, 'removed')])] },
      { id: 'o3', column: 'ready' as const, groups: [group([line('l6', 'تكة', 9)])] },
    ];
    expect(cookingTotals(orders, new Set())).toEqual([
      { name: 'تكة', qty: 5 },
      { name: 'لفة كص', qty: 1 },
    ]);
    expect(cookingTotals(orders, new Set([tickKey('o2', 'l3')]))).toEqual([
      { name: 'تكة', qty: 2 },
      { name: 'لفة كص', qty: 1 },
    ]);
  });

  it('writes the dishes for the ribbon, with how many more', () => {
    const o = { groups: [group([line('a', 'تكة', 2), line('b', 'كص', 1), line('c', 'ماي', 2), line('d', 'لبن', 1), line('e', 'x', 1, 'removed')])] };
    expect(dishLine(o)).toEqual({ shown: [{ qty: 2, name: 'تكة' }, { qty: 1, name: 'كص' }, { qty: 2, name: 'ماي' }], more: 1 });
  });
});

describe('dishesOut (m5)', () => {
  const lines = [
    { lineId: 'a', name: 'كباب', menuItemId: 'kebab' },
    { lineId: 'b', name: 'كباب', menuItemId: 'kebab' },
    { lineId: 'c', name: 'شي خاص', menuItemId: null },
    { lineId: 'd', name: 'لبن', menuItemId: 'laban' },
    { lineId: 'e', name: 'تكة', menuItemId: 'tikka' },
  ];
  it('names each ticked dish once, in ticket order, and skips free-text lines', () => {
    expect(dishesOut(lines, new Set(['d', 'b', 'a', 'c']))).toEqual([
      { id: 'kebab', name: 'كباب' },
      { id: 'laban', name: 'لبن' },
    ]);
  });
  it('is empty when nothing ticked has a dish on the menu', () => {
    expect(dishesOut(lines, new Set(['c']))).toEqual([]);
    expect(dishesOut(lines, new Set())).toEqual([]);
  });
});
