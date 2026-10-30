import { describe, expect, it } from 'vitest';
import type { MerchantInsights } from '@driver/contracts';
import { ratingText, STANDING_MIN_ORDERS, standingOf } from './standing';

const base = (over: Partial<MerchantInsights> = {}): MerchantInsights => ({
  merchantOrgId: 'org_1',
  from: new Date('2026-09-08T00:00:00Z'),
  to: new Date('2026-10-08T00:00:00Z'),
  prepHonesty: { samples: 40, quotedAvgMin: 15, actualAvgMin: 16, onTimeShare: 0.875 },
  rejection: { offered: 50, rejected: 2, rate: 0.04, trend: [] },
  itemRatings: [],
  peakHours: Array.from({ length: 24 }, () => 0),
  peakGrid: [],
  bestSellers: [],
  orders: 52,
  foodRating: { avg: 4.6, count: 18 },
  ...over,
});

describe('«وضعك»: the honest standing over 30 days (x6)', () => {
  it('three real numbers: on time, accepted, food rating', () => {
    const s = standingOf(base());
    expect(s.state).toBe('ready');
    if (s.state !== 'ready') return;
    expect(s.rows.map((r) => [r.key, r.value, r.tone, r.count])).toEqual([
      ['on_time', 88, 'good', 40],
      ['accepted', 96, 'good', 50],
      ['rating', 4.6, 'good', 18],
    ]);
    expect(s.rows[2]!.fill).toBeCloseTo(0.92);
  });

  it('too few orders: «بعد ما عندك طلبات كافية»', () => {
    expect(standingOf(base({ rejection: { offered: STANDING_MIN_ORDERS - 1, rejected: 0, rate: 0, trend: [] } }))).toEqual({ state: 'empty', offered: 9 });
  });

  it('bands: watch and bad say so; nothing rated or timed reads as none', () => {
    const s = standingOf(base({ prepHonesty: { samples: 0, quotedAvgMin: null, actualAvgMin: null, onTimeShare: null }, rejection: { offered: 20, rejected: 4, rate: 0.2, trend: [] }, foodRating: { avg: null, count: 0 } }));
    if (s.state !== 'ready') throw new Error('expected ready');
    expect(s.rows.map((r) => [r.key, r.value, r.tone])).toEqual([
      ['on_time', null, 'none'],
      ['accepted', 80, 'bad'],
      ['rating', null, 'none'],
    ]);
    const w = standingOf(base({ prepHonesty: { samples: 10, quotedAvgMin: 15, actualAvgMin: 18, onTimeShare: 0.7 }, foodRating: { avg: 4.2, count: 5 } }));
    if (w.state !== 'ready') throw new Error('expected ready');
    expect(w.rows[0]!.tone).toBe('watch');
    expect(w.rows[2]!.tone).toBe('watch');
  });

  it('an older API without the food score still shows the other two', () => {
    const { foodRating: _drop, ...old } = base();
    const s = standingOf(old as MerchantInsights);
    if (s.state !== 'ready') throw new Error('expected ready');
    expect(s.rows[2]).toMatchObject({ value: null, tone: 'none', count: 0 });
  });

  it('rating text: one decimal, whole numbers bare', () => {
    expect(ratingText(4.6)).toBe('4.6');
    expect(ratingText(5)).toBe('5');
  });
});
