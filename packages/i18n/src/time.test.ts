import { describe, expect, it } from 'vitest';
import { cityDayDiff, cityParts, formatClock, formatCountdown, formatDay, formatDuration, formatMinutes, formatWhen } from './time.js';

// 2026-10-01 is a Thursday. Baghdad is UTC+3: 19:30Z is 22:30 there.
const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-01T09:00:00Z'); // Thursday 12:00 noon, Baghdad

describe('formatClock: one clock, Asia/Baghdad, ص/م', () => {
  it('reads Baghdad wall time whatever the device zone, with the part of day', () => {
    expect(formatClock(at('2026-10-01T19:30:00Z'))).toBe('10:30 م');
    expect(formatClock(at('2026-10-01T04:30:00Z'))).toBe('7:30 ص');
    expect(formatClock(at('2026-10-01T09:05:00Z'))).toBe('12:05 م');
    expect(formatClock(at('2026-09-30T21:00:00Z'))).toBe('12:00 ص');
  });
  it('speaks English as AM/PM, and drops the period only on request', () => {
    expect(formatClock(at('2026-10-01T19:30:00Z'), { locale: 'en' })).toBe('10:30 PM');
    expect(formatClock(at('2026-10-01T19:30:00Z'), { period: false })).toBe('10:30');
  });
  it('accepts epoch milliseconds', () => {
    expect(formatClock(Date.parse('2026-10-01T19:30:00Z'))).toBe('10:30 م');
  });
});

describe('city calendar', () => {
  it('cuts days at Baghdad midnight, not UTC', () => {
    // 22:00Z on the 1st is already 01:00 on Friday the 2nd in Baghdad.
    expect(cityParts(at('2026-10-01T22:00:00Z'))).toMatchObject({ day: 2, dow: 5, hour: 1 });
    expect(cityDayDiff(at('2026-10-01T22:00:00Z'), NOW)).toBe(1);
    expect(cityDayDiff(at('2026-09-30T20:59:00Z'), NOW)).toBe(-1);
  });
});

describe('formatWhen / formatDay: a date wherever the day is not today', () => {
  it('today is the clock alone', () => {
    expect(formatWhen(at('2026-10-01T19:30:00Z'), NOW)).toBe('10:30 م');
  });
  it('tomorrow and yesterday by name', () => {
    expect(formatWhen(at('2026-10-02T04:30:00Z'), NOW)).toBe('باچر 7:30 ص');
    expect(formatWhen(at('2026-09-30T20:15:00Z'), NOW)).toBe('أمس 11:15 م');
  });
  it('a weekday within the coming week, a date beyond it', () => {
    expect(formatWhen(at('2026-10-04T18:00:00Z'), NOW)).toBe('الأحد 9:00 م');
    expect(formatDay(at('2026-10-07T18:00:00Z'), NOW)).toBe('الأربعاء');
    expect(formatWhen(at('2026-10-09T18:00:00Z'), NOW)).toBe('9/10 9:00 م');
    expect(formatWhen(at('2026-09-20T18:00:00Z'), NOW)).toBe('20/9 9:00 م');
  });
  it('English', () => {
    expect(formatWhen(at('2026-10-02T04:30:00Z'), NOW, { locale: 'en' })).toBe('Tomorrow 7:30 AM');
  });
});

describe('formatDuration: durations never look like a clock', () => {
  it('minutes under an hour, "دقيقة" for every count (voice spec §5)', () => {
    expect(formatMinutes(1)).toBe('1 دقيقة');
    expect(formatMinutes(45)).toBe('45 دقيقة');
  });
  it('hours with Arabic number agreement, then minutes', () => {
    expect(formatMinutes(60)).toBe('ساعة');
    expect(formatMinutes(80)).toBe('ساعة و20 دقيقة');
    expect(formatMinutes(125)).toBe('ساعتين و5 دقيقة');
    expect(formatMinutes(3 * 60)).toBe('3 ساعات');
    expect(formatMinutes(19 * 60 + 32)).toBe('19 ساعة و32 دقيقة');
  });
  it('short form for tight chips', () => {
    expect(formatMinutes(80, { style: 'short' })).toBe('1 س 20 د');
    expect(formatMinutes(45, { style: 'short' })).toBe('45 د');
    expect(formatMinutes(120, { style: 'short' })).toBe('2 س');
  });
  it('rounds part minutes up and never goes negative', () => {
    expect(formatDuration(61_000)).toBe('2 دقيقة');
    expect(formatDuration(-5)).toBe('0 دقيقة');
  });
  it('English', () => {
    expect(formatMinutes(80, { locale: 'en' })).toBe('1 hour 20 min');
  });
});

describe('formatCountdown', () => {
  it('m:ss, and h:mm:ss from an hour up', () => {
    expect(formatCountdown(116_000)).toBe('1:56');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
  });
});
