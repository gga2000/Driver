import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { composeDaySummary, dayAdvice, dayCounts, dayLabel, dayShareText, summaryDay } from './day-summary.js';

const at = (iso: string) => new Date(iso);
const MIN = 60_000;

function order(over: Partial<Order> & { id: string }): Order {
  return {
    state: 'closed',
    placedAt: at('2026-10-05T10:00:00Z'),
    acceptedAt: null,
    promisedReadyAt: null,
    readyAt: null,
    cancelledAt: null,
    cancellationReason: null,
    ...over,
  } as Order;
}

/** An order ready `late` minutes after its 15-minute promise (negative = early). */
function cooked(id: string, late: number): Order {
  const accepted = at('2026-10-05T10:00:00Z');
  const promised = new Date(accepted.getTime() + 15 * MIN);
  return order({ id, acceptedAt: accepted, promisedReadyAt: promised, readyAt: new Date(promised.getTime() + late * MIN) });
}

describe('end of day (S-M6) — which day, and when it shows', () => {
  it('during the day it is today, shown once the store is closed for the day', () => {
    expect(summaryDay(at('2026-10-05T18:00:00Z'), false)).toEqual({ localDate: '2026-10-05', due: false, reason: null }); // 21:00 Baghdad
    expect(summaryDay(at('2026-10-05T18:00:00Z'), true)).toEqual({ localDate: '2026-10-05', due: true, reason: 'closed' });
  });

  it('from 00:30 to 05:00 Baghdad it is the day before, shown by itself', () => {
    expect(summaryDay(at('2026-10-05T21:15:00Z'), false)).toEqual({ localDate: '2026-10-05', due: false, reason: null }); // 00:15
    expect(summaryDay(at('2026-10-05T21:30:00Z'), false)).toEqual({ localDate: '2026-10-05', due: true, reason: 'day_end' }); // 00:30
    expect(summaryDay(at('2026-10-06T01:59:00Z'), false)).toEqual({ localDate: '2026-10-05', due: true, reason: 'day_end' }); // 04:59
    expect(summaryDay(at('2026-10-06T02:00:00Z'), false)).toEqual({ localDate: '2026-10-06', due: false, reason: null }); // 05:00
    // A grill that closed at 00:10 shows yesterday's card at once.
    expect(summaryDay(at('2026-10-05T21:10:00Z'), true)).toEqual({ localDate: '2026-10-05', due: true, reason: 'closed' });
  });
});

describe('end of day (S-M6) — the numbers', () => {
  it('counts orders taken, misses outside a pause, rejections and the on-time share (2-min grace)', () => {
    const orders = [
      cooked('a', 0),
      cooked('b', 2),
      cooked('c', 3),
      order({ id: 'd', state: 'merchant_rejected', cancellationReason: 'merchant_timeout', cancelledAt: at('2026-10-05T10:01:30Z') }),
      order({ id: 'e', state: 'merchant_rejected', cancellationReason: 'merchant_timeout', cancelledAt: at('2026-10-05T09:31:30Z') }),
      order({ id: 'f', state: 'merchant_rejected', cancellationReason: 'sold_out' }),
      order({ id: 'g', state: 'customer_cancelled' }),
      order({ id: 'h', state: 'placed' }),
    ];
    const inPause = (t: Date) => t.getTime() < at('2026-10-05T09:45:00Z').getTime();
    expect(dayCounts(orders, inPause)).toEqual({ orders: 3, missed: 1, rejected: 1, onTimeShare: 0.667, onTimeSamples: 3, gapMin: 1.7 });
  });

  it('one advice line, the costliest first', () => {
    const base = { orders: 10, missed: 0, rejected: 0, onTimeShare: 0.9, onTimeSamples: 10, gapMin: 0 };
    expect(dayAdvice({ ...base, missed: 1, gapMin: 9 })).toEqual({ kind: 'missed', minutes: null, percent: null });
    expect(dayAdvice({ ...base, gapMin: 4.4 })).toEqual({ kind: 'prep_late', minutes: 4, percent: null });
    expect(dayAdvice({ ...base, onTimeShare: 0.6 })).toEqual({ kind: 'prep_uneven', minutes: null, percent: 40 });
    expect(dayAdvice({ ...base, rejected: 2 })).toEqual({ kind: 'rejected', minutes: null, percent: null });
    expect(dayAdvice({ ...base, gapMin: -6 })).toEqual({ kind: 'prep_early', minutes: 6, percent: null });
    expect(dayAdvice(base)).toEqual({ kind: 'honest', minutes: null, percent: null });
    expect(dayAdvice({ ...base, orders: 0, onTimeShare: null, onTimeSamples: 0, gapMin: null })).toBeNull();
  });
});

describe('end of day (S-M6) — the WhatsApp text', () => {
  const counts = (orders: number) => ({ orders, missed: 0, rejected: 0, onTimeShare: 0.91, onTimeSamples: orders, gapMin: 0 });
  const line = (orders: number) => dayShareText({ storeName: 'مطعم خالد', localDate: '2026-10-05', counts: counts(orders), netIqd: null }).split('\n')[1];

  it('Iraqi plurals for طلب: طلب واحد · طلبين · 3 طلبات · 10 طلبات · 11 طلب · 42 طلب', () => {
    expect(line(1)).toBe('طلب واحد · فاتك 0 · وقتك مضبوط 91%');
    expect(line(2)).toBe('طلبين · فاتك 0 · وقتك مضبوط 91%');
    expect(line(3)).toBe('3 طلبات · فاتك 0 · وقتك مضبوط 91%');
    expect(line(10)).toBe('10 طلبات · فاتك 0 · وقتك مضبوط 91%');
    expect(line(11)).toBe('11 طلب · فاتك 0 · وقتك مضبوط 91%');
    expect(line(42)).toBe('42 طلب · فاتك 0 · وقتك مضبوط 91%');
  });

  it('store and day first, the net (owner) with a thousands comma and دينار, the sender last', () => {
    expect(dayLabel('2026-10-05')).toBe('الاثنين 5/10');
    expect(dayShareText({ storeName: 'مطعم خالد', localDate: '2026-10-05', counts: counts(42), netIqd: 512000 })).toBe(
      ['مطعم خالد · ملخص الاثنين 5/10', '42 طلب · فاتك 0 · وقتك مضبوط 91%', 'الصافي 512,000 دينار', 'عن طريق درايفر للمطاعم'].join('\n'),
    );
    // No sample yet: no on-time figure rather than a made-up one.
    expect(dayShareText({ storeName: 'م', localDate: '2026-10-05', counts: { ...counts(0), onTimeShare: null, onTimeSamples: 0 }, netIqd: null }).split('\n')[1]).toBe('0 طلب · فاتك 0');
  });

  it('a day with nothing on it is never "due"', () => {
    const s = composeDaySummary({ merchantOrgId: 'm', storeName: 'م', day: { localDate: '2026-10-05', due: true, reason: 'closed' }, orders: [], netIqd: 0 });
    expect(s).toMatchObject({ due: false, reason: null, orders: 0, advice: null });
  });

  it('no net while every order is still in the kitchen or on the road (money is booked at delivery)', () => {
    const day = { localDate: '2026-10-05', due: true, reason: 'closed' as const };
    const open = [order({ id: 'a', state: 'preparing' }), order({ id: 'b', state: 'ready' })];
    const pending = composeDaySummary({ merchantOrgId: 'm', storeName: 'م', day, orders: open, netIqd: 0 });
    expect(pending).toMatchObject({ orders: 2, netIqd: null });
    expect(pending.share_ar).not.toContain('الصافي');
    expect(composeDaySummary({ merchantOrgId: 'm', storeName: 'م', day, orders: open, netIqd: 12_750 }).netIqd).toBe(12_750);
  });
});
