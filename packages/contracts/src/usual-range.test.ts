import { describe, expect, it } from 'vitest';
import { extraWaitHours, OfferWaitTerms, offerNeedsWaitTerms, waitExtraIqd, pricierThanUsual, usualRangeOf, DEFAULT_REQUEST_DETAILS } from './routes-io.js';

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

describe('offer waiting terms (w1)', () => {
  it('never takes a negative extra-hour price', () => {
    expect(OfferWaitTerms.safeParse({ includedHours: 4, extraHourIqd: -5_000 }).success).toBe(false);
    expect(OfferWaitTerms.safeParse({ includedHours: 4, extraHourIqd: 0 }).success).toBe(true);
    expect(OfferWaitTerms.safeParse({ includedHours: 4, extraHourIqd: 50_001 }).success).toBe(false);
  });
});

describe('extra waiting (w4)', () => {
  it('the first 15 minutes past the included hours are free, then each started hour counts', () => {
    expect(extraWaitHours(4 * 60, 4, 15)).toBe(0);
    expect(extraWaitHours(4 * 60 + 15, 4, 15)).toBe(0);
    expect(extraWaitHours(4 * 60 + 16, 4, 15)).toBe(1);
    expect(extraWaitHours(5 * 60 + 10, 4, 15)).toBe(1);
    expect(extraWaitHours(5 * 60 + 16, 4, 15)).toBe(2);
    expect(extraWaitHours(30, 0, 15)).toBe(1);
  });
  it('adds nothing while the rule is off', () => {
    const c = { startedAt: new Date('2026-10-08T08:00:00Z'), endedAt: new Date('2026-10-08T14:00:00Z'), includedHours: 4, extraHourIqd: 5_000, freeMin: 15 };
    expect(waitExtraIqd({ ...c, charged: false }, new Date())).toBe(0);
    expect(waitExtraIqd({ ...c, charged: true }, new Date())).toBe(10_000);
  });
});
