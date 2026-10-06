import { describe, expect, it } from 'vitest';
import type { PublicSeason } from '@driver/contracts';
import { cueAllowed, LOUD_SEASON, SeasonState } from './season';

const QUIET: PublicSeason = { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-13' };

describe('season', () => {
  it('starts as an ordinary day and tells listeners only when something changes', () => {
    const s = new SeasonState();
    expect(s.current).toEqual(LOUD_SEASON);
    let calls = 0;
    const off = s.subscribe(() => {
      calls += 1;
    });
    s.set({ ...LOUD_SEASON });
    expect(calls).toBe(0);
    s.set(QUIET);
    expect(s.current.quiet).toBe(true);
    expect(calls).toBe(1);
    off();
    s.set(LOUD_SEASON);
    expect(calls).toBe(1);
  });

  it('a moment sound needs the in-app switch on and a day that is not quiet', () => {
    expect(cueAllowed(true, LOUD_SEASON)).toBe(true);
    expect(cueAllowed(false, LOUD_SEASON)).toBe(false);
    expect(cueAllowed(true, QUIET)).toBe(false);
  });
});
