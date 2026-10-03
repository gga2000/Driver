import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { balanceText, lineAmount, lineWhen, pointsWorthText } from './wallet-format';

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
    expect(strip(lineAmount({ amount: -16_500, unit: 'iqd' }, 'ar-IQ', t))).toBe('−16,500 دينار');
    expect(strip(lineAmount({ amount: 20_000, unit: 'iqd' }, 'ar-IQ', t))).toBe('+20,000 دينار');
    expect(strip(lineAmount({ amount: 27, unit: 'points' }, 'ar-IQ', t))).toBe('+27 نقطة');
  });

  it('balance reads as owed when negative', () => {
    expect(strip(balanceText(3_500, 'ar-IQ', t))).toBe('3,500 دينار');
    expect(strip(balanceText(-500, 'ar-IQ', t))).toBe('عليك 500 دينار');
  });

  it('today / yesterday / date', () => {
    const now = new Date(2026, 9, 3, 18, 0);
    expect(lineWhen(new Date(2026, 9, 3, 7, 5), now, t)).toBe('اليوم 7:05');
    expect(lineWhen(new Date(2026, 9, 2, 21, 30), now, t)).toBe('أمس 9:30');
    expect(lineWhen(new Date(2026, 8, 28, 12, 0), now, t)).toBe('28/9');
  });
});
