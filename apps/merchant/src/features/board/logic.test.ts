import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { cardTiming, clampPrep, committedPrep, courierLine, defaultPrepChoice, partialValid, rejectReasonValue, splitColumns, unacknowledged } from './logic';

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
});
