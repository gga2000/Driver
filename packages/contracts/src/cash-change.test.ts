import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES } from './ledger-rules.js';
import { CHANGE_RULES, changeDue, changeToWalletProblem, IRAQI_NOTES_IQD, tenderOptions, tenderProblem, TENDER_CHIPS_MAX } from './cash-change.js';

describe('"الخردة علينا" — shared cash-change rules', () => {
  it('the caps are the money config (25,000 to the wallet, a 50,000 note at most above the total)', () => {
    expect(CHANGE_RULES).toEqual({ maxIqd: 25_000, tenderMaxOverIqd: 50_000, stepIqd: 250 });
    expect(AZIZIYAH_MONEY_RULES.changeToWallet).toEqual({ maxIqd: 25_000, tenderMaxOverIqd: 50_000 });
  });

  it('chips: the exact amount, then the single notes above it, at most four', () => {
    expect(tenderOptions(17_750)).toEqual([17_750, 20_000, 25_000, 50_000]);
    expect(tenderOptions(4_750)).toEqual([4_750, 5_000, 10_000, 20_000]);
    expect(tenderOptions(14_000)).toEqual([14_000, 20_000, 25_000, 50_000]);
    expect(tenderOptions(26_000)).toEqual([26_000, 50_000]);
    // A total that is already a note: that note is the exact chip, the next notes follow.
    expect(tenderOptions(25_000)).toEqual([25_000, 50_000]);
    expect(tenderOptions(60_000)).toEqual([60_000]);
    expect(tenderOptions(0)).toEqual([]);
    expect(tenderOptions(1_000).length).toBeLessThanOrEqual(TENDER_CHIPS_MAX);
    expect(IRAQI_NOTES_IQD).toContain(25_000);
  });

  it('a stated note is at least the total, at most 50,000 above it, in 250s', () => {
    expect(tenderProblem(25_000, 17_750)).toBeNull();
    expect(tenderProblem(17_750, 17_750)).toBeNull();
    expect(tenderProblem(17_500, 17_750)).toBe('below_total');
    expect(tenderProblem(70_000, 17_750)).toBe('above_cap');
    expect(tenderProblem(67_750, 17_750)).toBeNull();
    expect(tenderProblem(20_100, 17_750)).toBe('not_step');
  });

  it('change due is what the note is over the total, never negative', () => {
    expect(changeDue(25_000, 17_750)).toBe(7_250);
    expect(changeDue(17_750, 17_750)).toBe(0);
    expect(changeDue(10_000, 17_750)).toBe(0);
  });

  it('change to the wallet: cash only, recomputed, positive, capped, in 250s', () => {
    const ok = { paymentMethod: 'cash', totalIqd: 17_750, collectedIqd: 25_000, changeToWalletIqd: 7_250 };
    expect(changeToWalletProblem(ok)).toBeNull();
    expect(changeToWalletProblem({ ...ok, paymentMethod: 'wallet' })).toBe('not_cash');
    expect(changeToWalletProblem({ ...ok, changeToWalletIqd: 7_500 })).toBe('mismatch');
    expect(changeToWalletProblem({ ...ok, collectedIqd: 17_750, changeToWalletIqd: 0 })).toBe('not_positive');
    expect(changeToWalletProblem({ ...ok, collectedIqd: 50_000, changeToWalletIqd: 32_250 })).toBe('above_cap');
    expect(changeToWalletProblem({ paymentMethod: 'cash', totalIqd: 3_100, collectedIqd: 5_000, changeToWalletIqd: 1_900 })).toBe('not_step');
    expect(changeToWalletProblem({ paymentMethod: 'cash', totalIqd: 0, collectedIqd: 25_000, changeToWalletIqd: 25_000 })).toBeNull();
  });
});
