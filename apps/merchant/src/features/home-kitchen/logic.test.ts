import { describe, expect, it } from 'vitest';
import type { ReserveRule } from '@driver/contracts';
import { translate, type TKey } from '@/lib/i18n-core';
import { dayWhen, ruleLine, ruleReady, servesOf, SERVES, WEEK_ORDER } from './logic';

const t = (key: never, params?: Record<string, string | number>) => translate(key as TKey, params, 'ar-IQ');
const rule = (over: Partial<ReserveRule> = {}): ReserveRule => ({ aheadMin: 1440, days: [0, 1, 2, 3, 4, 5, 6], times: ['13:00'], maxPerSlot: 6, ...over });

describe('أكل بيت, the cook side', () => {
  it('names a pickup day on the city clock: اليوم, باچر, then the weekday', () => {
    // 2026-10-12 is a Monday; 22:30 UTC is already Tuesday 01:30 in Iraq.
    const now = new Date('2026-10-12T09:00:00Z');
    expect(dayWhen(new Date('2026-10-12T10:00:00Z'), now, t).day).toBe('اليوم');
    expect(dayWhen(new Date('2026-10-12T22:30:00Z'), now, t).day).toBe('باچر');
    expect(dayWhen(new Date('2026-10-15T10:00:00Z'), now, t).day).toBe(translate('merchant.date.dow_4' as TKey, undefined, 'ar-IQ'));
  });

  it('a rule saves only with a day and a time', () => {
    expect(ruleReady(rule())).toBe(true);
    expect(ruleReady(rule({ days: [] }))).toBe(false);
    expect(ruleReady(rule({ times: [] }))).toBe(false);
  });

  it('lands any serves range on the nearest chip', () => {
    expect(servesOf(null, null)).toBe('1');
    expect(servesOf(2, 2)).toBe('2');
    expect(servesOf(3, 4)).toBe('3-4');
    expect(servesOf(6, null)).toBe('family');
    for (const [chip, [min, max]] of Object.entries(SERVES)) expect(servesOf(min, max)).toBe(chip);
  });

  it('reads a rule the way the customer sees it, the week from Saturday and the times in order', () => {
    expect(ruleLine(rule({ times: ['19:00', '13:00'] }), t)).toBe('احجز قبل يوم · كل يوم · 1:00 م و 7:00 م');
    const line = ruleLine(rule({ aheadMin: 240, days: [5, 6, 0] }), t);
    expect(line.startsWith('احجز قبل 4 ساعات · ')).toBe(true);
    const named = WEEK_ORDER.filter((d) => [5, 6, 0].includes(d)).map((d) => translate(`merchant.date.dow_${d}` as TKey, undefined, 'ar-IQ'));
    expect(line).toContain(named.join('، '));
  });
});
