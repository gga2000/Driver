import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { courierReasons, disputeKindFor, keepFitting, lowReasons, ratingBranch, tipCard } from './rating-logic';

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

  it('asks about the food only when the food got 1–3; the courier’s reasons live on step 1', () => {
    expect(lowReasons('food', 2)).toEqual(['cold', 'missing_item']);
    expect(lowReasons('food', 5)).toEqual([]);
    expect(lowReasons('food', null)).toEqual([]);
    expect(lowReasons('ride', null)).toEqual([]);
  });

  it('opens the complaint that matches the reasons', () => {
    expect(disputeKindFor(['cold', 'missing_item'], 'food')).toBe('missing_item');
    expect(disputeKindFor(['late'], 'food')).toBe('cold_or_late');
    expect(disputeKindFor(['cold'], 'food')).toBe('cold_or_late');
    expect(disputeKindFor([], 'food', ['late'])).toBe('cold_or_late');
    expect(disputeKindFor([], 'food', ['rude'])).toBe('other');
    expect(disputeKindFor([], 'food')).toBe('other');
    expect(disputeKindFor(['late'], 'ride', ['late'])).toBe('other');
  });
});

describe('rate the courier (step 1 reasons)', () => {
  it('offers what went wrong under 1–3 and what was good under 4–5, per delivery or ride', () => {
    expect(courierReasons(2, 'food')).toEqual(['late', 'rude', 'mishandled', 'hard_to_reach']);
    expect(courierReasons(5, 'food')).toEqual(['polite', 'fast', 'careful', 'found_us']);
    expect(courierReasons(1, 'ride')).toEqual(['late', 'rude', 'hard_to_reach', 'unsafe_driving']);
    expect(courierReasons(4, 'ride')).toEqual(['polite', 'fast', 'found_us', 'safe_driving']);
    expect(courierReasons(0, 'food')).toEqual([]);
  });

  it('changing the stars drops the reasons that no longer fit', () => {
    expect(keepFitting(['late', 'rude'], 5, 'food')).toEqual([]);
    expect(keepFitting(['polite', 'careful'], 4, 'food')).toEqual(['polite', 'careful']);
    expect(keepFitting(['careful'], 4, 'ride')).toEqual([]);
  });

  it('every reason has Iraqi words in both languages', () => {
    const ar = createT('ar-IQ');
    const en = createT('en');
    for (const r of [...courierReasons(1, 'food'), ...courierReasons(5, 'food'), ...courierReasons(1, 'ride'), ...courierReasons(5, 'ride')]) {
      expect(ar(`rating.courier.${r}` as never)).not.toContain('rating.courier');
      expect(en(`rating.courier.${r}` as never)).not.toContain('rating.courier');
    }
    expect(ar('rating.courier_good_q', { name: 'عباس' })).toBe('شنو عجبك بـ عباس؟');
  });
});

describe('the tip card after a good rating (Ali, 2026-10-06)', () => {
  const offer = (over: Partial<{ offered: boolean; amountsIqd: number[]; tip: { amountIqd: number; at: Date } | null }> = {}) => ({ offered: true, amountsIqd: [500, 1000, 2000], tip: null, ...over });
  it('chips when his wallet covers some, the cash note when it covers none', () => {
    expect(tipCard(offer())).toBe('chips');
    expect(tipCard(offer({ amountsIqd: [] }))).toBe('cash_note');
  });
  it('nothing when not offered, not loaded, or after «لا شكراً»; thanks once he tipped', () => {
    expect(tipCard(offer({ offered: false, amountsIqd: [] }))).toBe('hidden');
    expect(tipCard(null)).toBe('hidden');
    expect(tipCard(offer(), true)).toBe('hidden');
    expect(tipCard(offer({ amountsIqd: [], tip: { amountIqd: 1000, at: new Date() } }))).toBe('thanks');
  });
  it('speaks Iraqi, with دينار after every amount', () => {
    const t = createT('ar-IQ');
    expect(t('tip.ask', { name: 'عباس' })).toBe('تحب تكرم عباس؟');
    expect(t('tip.chip', { amount: '1,000' })).toBe('1,000 دينار');
    expect(t('tip.no_thanks')).toBe('لا شكراً');
  });
});
