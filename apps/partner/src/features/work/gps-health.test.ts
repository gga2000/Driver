import { describe, expect, it } from 'vitest';
import { GPS_WEAK_AFTER_MS, gpsWeakFor } from './gps-health';

const T0 = 1_000_000;

describe('gpsWeakFor (n7)', () => {
  it('says nothing before the phone gives any position (the GPS chip covers that)', () => {
    expect(gpsWeakFor({ goodAt: 0, seen: false }, T0, T0 + 10 * 60_000)).toBeNull();
  });
  it('is fine while good positions keep coming', () => {
    expect(gpsWeakFor({ goodAt: T0 + 50_000, seen: true }, T0, T0 + 60_000)).toBeNull();
  });
  it('waits 30 s from the screen opening before warning', () => {
    expect(gpsWeakFor({ goodAt: 0, seen: true }, T0, T0 + GPS_WEAK_AFTER_MS - 1)).toBeNull();
    expect(gpsWeakFor({ goodAt: 0, seen: true }, T0, T0 + GPS_WEAK_AFTER_MS)).toEqual({ lastSeenMin: null });
  });
  it('gives the minutes since the customer last saw him move, at least 1', () => {
    expect(gpsWeakFor({ goodAt: T0, seen: true }, T0, T0 + 40_000)).toEqual({ lastSeenMin: 1 });
    expect(gpsWeakFor({ goodAt: T0, seen: true }, T0, T0 + 4 * 60_000 + 5_000)).toEqual({ lastSeenMin: 4 });
  });
});
