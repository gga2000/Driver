import { describe, expect, it } from 'vitest';
import { busiest, comebackDish, daysWithUs, gridDayKey, labelledColumn, onTimePercent, periodTotals, savedLabel, savedParts, savedPer10k } from './format';

describe('stats format', () => {
  it('savedParts: biggest first, empty parts dropped', () => {
    expect(savedParts({ totalIqd: 4_500, dealsIqd: 1_000, promosIqd: 0, pointsIqd: 500, returnTripIqd: 3_000, madeGoodIqd: 2_000 })).toEqual([
      { key: 'stats.part_return', amount: 3_000 },
      { key: 'stats.part_deals', amount: 1_000 },
      { key: 'stats.part_points', amount: 500 },
    ]);
  });

  it('savedLabel: this month, a past month by name, the year, since the start', () => {
    expect(savedLabel('month', '2026-10', '2026-10')).toEqual({ key: 'stats.saved_month' });
    expect(savedLabel('month', '2026-09', '2026-10')).toEqual({ key: 'stats.saved_month_past', monthKey: 'time.month_9' });
    expect(savedLabel('year', null, '2026-10')).toEqual({ key: 'stats.saved_year' });
    expect(savedLabel('all', null, '2026-10')).toEqual({ key: 'stats.saved_all' });
  });

  it('periodTotals and labelledColumn (every third back from the latest)', () => {
    const m = (food: number, taxi: number) => ({ month: '2026-09' as const, food, taxi, tuktuk: 1, rajaa: 0 });
    expect(periodTotals([m(2, 1), m(3, 0)])).toEqual({ food: 5, tuktuk: 2, taxi: 1, rajaa: 0 });
    expect([0, 1, 2, 3, 4, 5].map((i) => labelledColumn(i, 6))).toEqual([true, true, true, true, true, true]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => labelledColumn(i, 10))).toEqual([true, false, false, true, false, false, true, false, false, true]);
  });

  it('comebackDish only when ordered twice or more; busiest grid cell; weekday keys start Saturday', () => {
    expect(comebackDish([{ orders: 1 }])).toBeNull();
    expect(comebackDish([{ orders: 3 }])).toEqual({ orders: 3 });
    expect(busiest([[0, 2], [5, 1]])).toEqual({ day: 1, band: 0, n: 5 });
    expect(busiest([[0, 0]])).toBeNull();
    expect(gridDayKey(0)).toBe('time.dow_6');
    expect(gridDayKey(1)).toBe('time.dow_0');
  });

  it('per 10,000 دينار, on-time percent and days with us (Baghdad days)', () => {
    expect(savedPer10k(1_500, 60_000)).toBe(250);
    expect(savedPer10k(1_500, 0)).toBeNull();
    expect(onTimePercent({ promised: 3, onTime: 2 })).toBe(67);
    expect(onTimePercent({ promised: 0, onTime: 0 })).toBeNull();
    expect(daysWithUs(new Date('2026-10-01T20:59:00Z'), new Date('2026-10-01T21:00:00Z'))).toBe(2);
  });
});
