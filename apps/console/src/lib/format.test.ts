import { describe, expect, it } from 'vitest';
import { formatClock, formatCountdown, formatDayClock, formatIqd, formatMoney, formatSigned, fromLocalInputValue, safeDecode, shortId, toLocalInputValue } from './format';

describe('money formatting (voice guide §5)', () => {
  it('uses Western digits with a comma thousands separator', () => {
    expect(formatIqd(1000)).toBe('1,000');
    expect(formatIqd(12500)).toBe('12,500');
    expect(formatIqd(0)).toBe('0');
  });
  it('never emits Eastern-Arabic digits', () => {
    expect(formatMoney(1234567)).not.toMatch(/[٠-٩]/);
  });
  it('puts دينار after the number and IQD in English', () => {
    expect(formatMoney(1500)).toBe('1,500 دينار');
    expect(formatMoney(1500, 'en')).toBe('1,500 IQD');
  });
  it('signs line amounts for the quote table', () => {
    expect(formatSigned(1000)).toBe('+1,000');
    expect(formatSigned(-250)).toBe('−250');
    expect(formatSigned(0)).toBe('0');
  });
  it('truncates stray fractions (IQD is integer-only)', () => {
    expect(formatIqd(999.9)).toBe('999');
  });
});

describe('time helpers', () => {
  it('round-trips a datetime-local value', () => {
    const d = new Date(2026, 9, 3, 23, 30);
    const v = toLocalInputValue(d);
    expect(v).toBe('2026-10-03T23:30');
    expect(fromLocalInputValue(v)?.getTime()).toBe(d.getTime());
  });
  it('rejects empty and invalid input', () => {
    expect(fromLocalInputValue('')).toBeNull();
    expect(fromLocalInputValue('nope')).toBeNull();
  });
  it('formats a 12-hour clock with ص/م in Baghdad time', () => {
    // Baghdad is UTC+3 all year.
    expect(formatClock(new Date('2026-10-03T04:05:00Z'))).toBe('7:05 ص');
    expect(formatClock(new Date('2026-10-03T20:30:00Z'))).toBe('11:30 م');
    expect(formatClock(new Date('2026-10-03T21:00:00Z'))).toBe('12:00 ص');
  });
});

describe('console helpers', () => {
  it('formats countdowns as {minutes}:{seconds}', () => {
    expect(formatCountdown(7)).toBe('0:07');
    expect(formatCountdown(125)).toBe('2:05');
    expect(formatCountdown(3660)).toBe('61:00');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(null)).toBe('—');
  });
  it('formats day and clock in Baghdad time', () => {
    expect(formatDayClock(new Date('2026-10-03T16:05:00Z'))).toBe('3/10 · 7:05 م');
  });
  it('shortens long ids only', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('cmh3x9abcdefa1b2')).toBe('cmh3x9…a1b2');
  });
  it('decodes route params safely', () => {
    expect(safeDecode('a%20b')).toBe('a b');
    expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
