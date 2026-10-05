import { describe, expect, it } from 'vitest';
import { disputeKindFor, lowReasons, ratingBranch } from './rating-logic';

describe('rating branches (C-12)', () => {
  it('asks what went wrong when either score is 3 or less', () => {
    expect(ratingBranch(5, 5)).toBe('thanks');
    expect(ratingBranch(4, null)).toBe('thanks');
    expect(ratingBranch(5, 3)).toBe('recover');
    expect(ratingBranch(2, 5)).toBe('recover');
    expect(ratingBranch(1, null)).toBe('recover');
    // A skipped food score (0) doesn't count as low.
    expect(ratingBranch(5, 0)).toBe('thanks');
  });

  it('offers kitchen and courier reasons on food, driver reasons on rides', () => {
    expect(lowReasons('food')).toEqual(['cold', 'missing_item', 'late', 'rude']);
    expect(lowReasons('ride')).toEqual(['late', 'rude']);
  });

  it('opens the complaint that matches the reasons', () => {
    expect(disputeKindFor(['cold', 'missing_item'], 'food')).toBe('missing_item');
    expect(disputeKindFor(['late'], 'food')).toBe('cold_or_late');
    expect(disputeKindFor(['cold'], 'food')).toBe('cold_or_late');
    expect(disputeKindFor(['rude'], 'food')).toBe('other');
    expect(disputeKindFor([], 'food')).toBe('other');
    expect(disputeKindFor(['late'], 'ride')).toBe('other');
  });
});
