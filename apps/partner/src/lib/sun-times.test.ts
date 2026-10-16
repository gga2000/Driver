import { describe, expect, it } from 'vitest';
import { nightAt, sunTimes } from './sun-times';

/** Baghdad time (UTC+3, no daylight saving) as HH:MM. */
const iq = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(11, 16);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('sunrise and sunset in Aziziyah (night look, n2)', () => {
  it('matches published times within a few minutes', () => {
    // Published for Kut/Aziziyah: 8 Oct ≈ 05:57 / 17:39; 21 Jun ≈ 04:53 / 19:05; 21 Dec ≈ 06:53 / 16:56.
    const cases: [string, string, string][] = [
      ['2026-10-08', '05:57', '17:39'],
      ['2026-06-21', '04:53', '19:05'],
      ['2026-12-21', '06:53', '16:56'],
    ];
    for (const [day, rise, set] of cases) {
      const s = sunTimes(new Date(`${day}T12:00:00Z`))!;
      expect(Math.abs(minutes(iq(s.sunrise)) - minutes(rise))).toBeLessThanOrEqual(5);
      expect(Math.abs(minutes(iq(s.sunset)) - minutes(set))).toBeLessThanOrEqual(5);
    }
  });

  it('is night before sunrise and after sunset, and names the next change', () => {
    const noon = nightAt(new Date('2026-10-08T09:00:00Z'));
    expect(noon.night).toBe(false);
    expect(iq(noon.nextChange).slice(0, 2)).toBe('17');
    const evening = nightAt(new Date('2026-10-08T17:00:00Z'));
    expect(evening.night).toBe(true);
    expect(evening.nextChange.toISOString().slice(0, 10)).toBe('2026-10-09');
    const dawn = nightAt(new Date('2026-10-08T01:00:00Z'));
    expect(dawn.night).toBe(true);
    expect(dawn.nextChange.toISOString().slice(0, 10)).toBe('2026-10-08');
  });
});
