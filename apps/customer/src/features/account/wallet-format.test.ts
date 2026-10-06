import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { balanceText, lineAmount, lineWhen, paidOutsideWallet, pointsWorthText } from './wallet-format';

const t = createT('ar-IQ');
const en = createT('en');
const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');

describe('wallet formatting', () => {
  it('points worth at 100 points = 1,000 IQD', () => {
    expect(strip(pointsWorthText(2_500, 10, t))).toBe('2,500 نقطة = 25,000 دينار');
    expect(strip(pointsWorthText(100, 10, en))).toBe('100 points = 1,000 IQD');
    expect(strip(pointsWorthText(0, 10, t))).toBe('0 نقطة = 0 دينار');
  });

  it('signed line amounts in IQD and points', () => {
    expect(strip(lineAmount({ amount: -16_500, unit: 'iqd', method: 'wallet' }, 'ar-IQ', t))).toBe('−16,500 دينار');
    expect(strip(lineAmount({ amount: 20_000, unit: 'iqd', method: null }, 'ar-IQ', t))).toBe('+20,000 دينار');
    expect(strip(lineAmount({ amount: 27, unit: 'points', method: null }, 'ar-IQ', t))).toBe('+27 نقطة');
  });

  it('a cash-at-the-door order reads as its price, not a wallet debit', () => {
    const cash = { amount: -14_000, unit: 'iqd', method: 'cash' } as const;
    expect(paidOutsideWallet(cash)).toBe(true);
    expect(strip(lineAmount(cash, 'ar-IQ', t))).toBe('14,000 دينار');
    expect(strip(lineAmount(cash, 'en', en))).toBe('14,000 IQD');
    expect(paidOutsideWallet({ unit: 'iqd', method: 'wallet' })).toBe(false);
    expect(paidOutsideWallet({ unit: 'iqd', method: null })).toBe(false);
  });

  it('balance reads as owed when negative', () => {
    expect(strip(balanceText(3_500, 'ar-IQ', t))).toBe('3,500 دينار');
    expect(strip(balanceText(-500, 'ar-IQ', t))).toBe('عليك 500 دينار');
  });

  it('today / yesterday / date', () => {
    // Baghdad is UTC+3 whatever the test machine's zone: 15:00Z is 6 in the evening there.
    const now = new Date('2026-10-03T15:00:00Z');
    expect(lineWhen(new Date('2026-10-03T04:05:00Z'), now, t)).toBe('اليوم 7:05 ص');
    expect(lineWhen(new Date('2026-10-02T18:30:00Z'), now, t)).toBe('أمس 9:30 م');
    expect(lineWhen(new Date('2026-09-28T09:00:00Z'), now, t)).toBe('28/9');
  });
});
