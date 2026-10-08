import { describe, expect, it } from 'vitest';
import { baghdadDay, parseShift, powerBack } from './shift';

const NOON = Date.UTC(2026, 9, 8, 9, 0); // 12:00 in Baghdad

describe('power back (y3)', () => {
  it('knows the tablet came back mid-shift, and for how long it was off', () => {
    const kept = { day: baghdadDay(NOON), aliveAt: NOON - 6 * 60_000 - 20_000 };
    expect(powerBack(kept, NOON)).toEqual({ offMinutes: 6 });
    expect(powerBack({ ...kept, aliveAt: NOON - 10_000 }, NOON)).toEqual({ offMinutes: 0 });
  });

  it('a new day, or nothing kept, is a normal start', () => {
    expect(powerBack(null, NOON)).toBeNull();
    expect(powerBack({ day: '2026-10-07', aliveAt: NOON - 60_000 }, NOON)).toBeNull();
  });

  it('reads only a well-formed record', () => {
    expect(parseShift('{"day":"2026-10-08","aliveAt":5}')).toEqual({ day: '2026-10-08', aliveAt: 5 });
    expect(parseShift('{"day":3}')).toBeNull();
    expect(parseShift('not json')).toBeNull();
    expect(parseShift(null)).toBeNull();
  });
});
