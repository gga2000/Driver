import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { disputeKindFor, lowReasons, ratingBranch, tipCard } from './rating-logic';

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
