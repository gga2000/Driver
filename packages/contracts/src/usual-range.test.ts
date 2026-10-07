import { describe, expect, it } from 'vitest';
import { offerNeedsWaitTerms, pricierThanUsual, usualRangeOf, DEFAULT_REQUEST_DETAILS } from './routes-io.js';

describe('the usual private-car price (p1–p3, Ali 2026-10-07)', () => {
  it('needs at least 5 finished trips; below that there is no number at all', () => {
    expect(usualRangeOf([])).toBeNull();
    expect(usualRangeOf([30_000, 32_000, 34_000, 36_000])).toBeNull();
  });

  it('is the middle of what was paid (20th to 80th percentile, nearest rank), rounded to 1,000', () => {
    expect(usualRangeOf([60_000, 30_000, 38_000, 35_000, 36_000])).toEqual({ lowIqd: 30_000, highIqd: 38_000, trips: 5 });
    const ten = [25_000, 30_000, 31_000, 32_000, 33_400, 34_000, 35_000, 36_000, 40_000, 90_000];
    // 20th → 2nd price, 80th → 8th price: one very cheap and one very dear trip don't move it.
    expect(usualRangeOf(ten)).toEqual({ lowIqd: 30_000, highIqd: 36_000, trips: 10 });
    expect(usualRangeOf([32_400, 32_400, 32_600, 32_600, 32_600])).toEqual({ lowIqd: 32_000, highIqd: 33_000, trips: 5 });
  });

  it('calls an offer pricier only when it is more than a quarter above the top', () => {
    const range = { lowIqd: 30_000, highIqd: 40_000, trips: 7 };
    expect(pricierThanUsual(50_000, range)).toBe(false);
    expect(pricierThanUsual(51_000, range)).toBe(true);
    expect(pricierThanUsual(99_000, null)).toBe(false);
  });

  it('only a «يستناك وترجع» trip asks drivers for waiting terms', () => {
    expect(offerNeedsWaitTerms({ ...DEFAULT_REQUEST_DETAILS, trip: 'wait_return', waitHours: 3 })).toBe(true);
    expect(offerNeedsWaitTerms(DEFAULT_REQUEST_DETAILS)).toBe(false);
    expect(offerNeedsWaitTerms({ ...DEFAULT_REQUEST_DETAILS, trip: 'two_days' })).toBe(false);
  });
});
