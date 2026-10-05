import { describe, expect, it } from 'vitest';
import { clock12, clockOffset, minutesBetween, minutesLeft, secondsLeft } from './time';

describe('kitchen time', () => {
  it('12-hour Baghdad clock with Western digits', () => {
    expect(clock12(new Date('2026-10-03T16:42:00Z'))).toBe('7:42 م');
    expect(clock12(new Date('2026-10-03T09:05:00Z'))).toBe('12:05 م');
    expect(clock12(new Date('2026-10-03T21:00:00Z'))).toBe('12:00 ص');
  });
  it('minutes since (floored) and left (ceiled), never negative', () => {
    const t = Date.parse('2026-10-03T17:00:00Z');
    expect(minutesBetween(t, t + 4.9 * 60_000)).toBe(4);
    expect(minutesBetween(t + 60_000, t)).toBe(0);
    expect(minutesLeft(t + 4.1 * 60_000, t)).toBe(5);
    expect(minutesLeft(t, t + 1)).toBe(0);
    expect(secondsLeft(t + 1500, t)).toBe(2);
  });
  it('server clock offset', () => {
    expect(clockOffset(new Date(10_000), 9_000)).toBe(1_000);
  });
});
