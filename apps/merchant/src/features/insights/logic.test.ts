import { describe, expect, it } from 'vitest';
import { activeHours, bestSellerRows, busiestWindow, canRankBySales, heatLevel, percent, prepVerdict, ratingTone, rejectionTrend, rejectionVerdict } from './logic';

const hours = (pairs: Record<number, number>) => Array.from({ length: 24 }, (_, i) => pairs[i] ?? 0);

describe('insights verdicts', () => {
  it('prep honesty: honest within 2 min, late, early, or no data', () => {
    expect(prepVerdict({ samples: 40, quotedAvgMin: 15, actualAvgMin: 16.2, onTimeShare: 0.85 })).toEqual({ kind: 'honest', tone: 'good', gapMin: 1 });
    expect(prepVerdict({ samples: 40, quotedAvgMin: 15, actualAvgMin: 19.4, onTimeShare: 0.7 })).toEqual({ kind: 'late', tone: 'watch', gapMin: 4 });
    expect(prepVerdict({ samples: 40, quotedAvgMin: 15, actualAvgMin: 23, onTimeShare: 0.4 })).toMatchObject({ kind: 'late', tone: 'bad', gapMin: 8 });
    expect(prepVerdict({ samples: 40, quotedAvgMin: 25, actualAvgMin: 18, onTimeShare: 1 })).toMatchObject({ kind: 'early', gapMin: 7 });
    expect(prepVerdict({ samples: 40, quotedAvgMin: 17, actualAvgMin: 18, onTimeShare: 0.59 })).toMatchObject({ kind: 'uneven', tone: 'watch' });
    expect(prepVerdict({ samples: 0, quotedAvgMin: null, actualAvgMin: null, onTimeShare: null }).kind).toBe('none');
  });

  it('rejection bands, week-on-week trend and percent text', () => {
    expect([0.02, 0.05, 0.12, null].map(rejectionVerdict)).toEqual(['good', 'watch', 'bad', 'none']);
    const b = (rate: number | null) => ({ from: new Date(), to: new Date(), offered: 10, rejected: 1, rate });
    expect(rejectionTrend([b(0.08), b(0.05)])).toBe('down');
    expect(rejectionTrend([b(0.03), b(0.06), b(null)])).toBe('up');
    expect(rejectionTrend([b(0.05)])).toBeNull();
    expect([0.042, 0.1, 0.03, 0.125].map(percent)).toEqual(['4.2', '10', '3', '13']);
  });

  it('ratings tone', () => {
    expect([3.2, 4, 4.6].map(ratingTone)).toEqual(['bad', 'watch', 'good']);
  });
});

describe('peak hours', () => {
  const grill = hours({ 11: 2, 12: 6, 13: 9, 14: 7, 15: 3, 18: 4, 19: 8, 20: 14, 21: 18, 22: 12, 23: 6, 0: 3, 1: 1 });

  it('finds the busiest two hours, wrapping midnight', () => {
    expect(busiestWindow(grill)).toEqual({ from: 20, to: 22, orders: 32 });
    expect(busiestWindow(hours({ 23: 5, 0: 6 }))).toEqual({ from: 23, to: 1, orders: 11 });
    expect(busiestWindow(hours({}))).toBeNull();
  });

  it('draws from opening to closing across midnight', () => {
    const a = activeHours(grill);
    expect(a[0]).toBe(11);
    expect(a.at(-1)).toBe(1);
    expect(a).toHaveLength(15);
    expect(activeHours(hours({ 20: 1 }))).toHaveLength(8);
    expect(activeHours(hours({}))).toHaveLength(24);
  });

  it('heat levels against the busiest cell', () => {
    expect([0, 1, 3, 6, 10].map((c) => heatLevel(c, 10))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('best sellers (M-13)', () => {
  // As the API sends them: ranked by sales, where a Pepsi sells far more often than a kilo of grill.
  const list = [
    { itemId: 'grill', nameAr: 'مشويات مشكّلة كيلو', qty: 46, orders: 40, salesIqd: 1_012_000 },
    { itemId: 'tikka', nameAr: 'تكة', qty: 320, orders: 200, salesIqd: 960_000 },
    { itemId: 'pepsi', nameAr: 'بيبسي', qty: 693, orders: 410, salesIqd: 346_500 },
  ];

  it('by count: ranked by quantity and scaled by the largest quantity — the bars match the numbers', () => {
    const rows = bestSellerRows(list, 'qty');
    expect(rows.map((r) => [r.rank, r.itemId])).toEqual([[1, 'pepsi'], [2, 'tikka'], [3, 'grill']]);
    expect(rows[0]!.share).toBe(1);
    expect(rows[2]!.share).toBeCloseTo(46 / 693, 5);
    // Every bar is no longer than the one above it.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.share).toBeLessThanOrEqual(rows[i - 1]!.share);
  });

  it('by money: ranked and scaled by sales; without sales (staff) it falls back to count', () => {
    const rows = bestSellerRows(list, 'sales');
    expect(rows.map((r) => r.itemId)).toEqual(['grill', 'tikka', 'pepsi']);
    expect(rows[1]!.share).toBeCloseTo(960_000 / 1_012_000, 5);
    const staff = list.map((b) => ({ ...b, salesIqd: null }));
    expect(canRankBySales(list)).toBe(true);
    expect(canRankBySales(staff)).toBe(false);
    expect(bestSellerRows(staff, 'sales').map((r) => r.itemId)).toEqual(['pepsi', 'tikka', 'grill']);
  });

  it('keeps the top 8 and handles an empty or all-zero list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ itemId: `i${i}`, nameAr: null, qty: i, orders: i, salesIqd: null }));
    expect(bestSellerRows(many, 'qty')).toHaveLength(8);
    expect(bestSellerRows([], 'qty')).toEqual([]);
    expect(bestSellerRows([{ itemId: 'x', nameAr: 'x', qty: 0, orders: 0, salesIqd: 0 }], 'qty')[0]!.share).toBe(0);
  });
});
