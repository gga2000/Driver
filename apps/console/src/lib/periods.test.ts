import { describe, expect, it } from 'vitest';
import { countForm, countText } from './plural';
import { dayHeading, dayKey, dayMonth, daysAgo, periodRange, rangeWords, recentDays, stamp, startOfDay } from './periods';

// 4 Oct 2026, 22:30 in Baghdad (19:30 UTC).
const NOW = new Date('2026-10-04T19:30:00Z');

describe('the city day (Asia/Baghdad, UTC+3)', () => {
  it('starts at Baghdad midnight, not UTC midnight', () => {
    expect(startOfDay(NOW).toISOString()).toBe('2026-10-03T21:00:00.000Z');
    // 23:30 UTC on the 4th is already the 5th in Baghdad.
    expect(dayKey(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-05');
    expect(daysAgo(new Date('2026-10-03T20:59:00Z'), NOW)).toBe(1);
    expect(daysAgo(new Date('2026-10-03T21:00:00Z'), NOW)).toBe(0);
  });

  it('names days in words with Western digits, never 4/10', () => {
    expect(dayMonth(NOW)).toBe('4 تشرين الأول');
    expect(dayMonth(new Date('2025-12-31T12:00:00Z'), NOW)).toBe('31 كانون الأول 2025');
    expect(dayHeading(NOW, NOW)).toBe('اليوم');
    expect(dayHeading(new Date('2026-10-03T12:00:00Z'), NOW)).toBe('أمس');
    expect(stamp(NOW, NOW)).toBe('10:30 م');
    expect(stamp(new Date('2026-10-03T07:05:00Z'), NOW)).toBe('أمس 10:05 ص');
    expect(stamp(new Date('2026-10-01T07:05:00Z'), NOW)).toBe('1 تشرين الأول · 10:05 ص');
  });
});

describe('period presets', () => {
  const today = new Date('2026-10-03T21:00:00Z');
  it('today, yesterday and the last 7 days run on Baghdad days', () => {
    expect(periodRange({ preset: 'today' }, NOW)).toEqual({ from: today });
    expect(periodRange({ preset: 'yesterday' }, NOW)).toEqual({ from: new Date('2026-10-02T21:00:00Z'), to: today });
    expect(periodRange({ preset: 'week' }, NOW)).toEqual({ from: new Date('2026-09-27T21:00:00Z') });
    expect(periodRange({ preset: 'month' }, NOW)).toEqual({ from: new Date('2026-09-30T21:00:00Z') });
    expect(periodRange({ preset: 'all' }, NOW)).toEqual({});
  });

  it('a custom range is inclusive of both days, and a backwards pick is swapped', () => {
    expect(periodRange({ preset: 'custom', fromDay: '2026-10-01', toDay: '2026-10-02' }, NOW)).toEqual({
      from: new Date('2026-09-30T21:00:00Z'),
      to: new Date('2026-10-02T21:00:00Z'),
    });
    expect(periodRange({ preset: 'custom', fromDay: '2026-10-02', toDay: '2026-10-01' }, NOW)).toEqual({
      from: new Date('2026-09-30T21:00:00Z'),
      to: new Date('2026-10-02T21:00:00Z'),
    });
  });

  it('says the range back in words', () => {
    expect(rangeWords({ preset: 'week' }, NOW)).toBe('آخر 7 أيام');
    expect(rangeWords({ preset: 'custom', fromDay: '2026-10-02', toDay: '2026-10-02' }, NOW)).toBe('2 تشرين الأول');
    expect(rangeWords({ preset: 'custom', fromDay: '2026-10-01', toDay: '2026-10-03' }, NOW)).toBe('من 1 تشرين الأول لحد 3 تشرين الأول');
  });

  it('offers the recent days newest first, by name', () => {
    const days = recentDays(NOW, 3);
    expect(days.map((d) => d.key)).toEqual(['2026-10-04', '2026-10-03', '2026-10-02']);
    expect(days.slice(0, 2).map((d) => d.label)).toEqual(['اليوم', 'أمس']);
  });
});

describe('Arabic counts', () => {
  it('picks the form people say', () => {
    expect([0, 1, 2, 3, 10, 11, 99, 100, 103, 111].map(countForm)).toEqual(['0', '1', '2', 'few', 'few', 'many', 'many', 'many', 'few', 'many']);
    expect(countText('console.orders_count', 0)).toBe('ولا طلب');
    expect(countText('console.orders_count', 2)).toBe('طلبين');
    expect(countText('console.orders_count', 5)).toBe('5 طلبات');
    expect(countText('console.orders_count', 50)).toBe('50 طلب');
    expect(countText('console.ledger_lines', 1)).toBe('حركة وحدة');
  });
});
