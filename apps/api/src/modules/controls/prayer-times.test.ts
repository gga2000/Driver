import { describe, expect, it } from 'vitest';
import { formatHhMm, iftarTimes, solarDay } from './prayer-times.js';
import { SEASON_RULES } from './season.config.js';

const BAGHDAD = { lat: 33.3152, lng: 44.3661 };
const AZIZIYAH = SEASON_RULES.defaultPlace;
/** Minutes after Baghdad midnight of a UTC instant (UTC+3, no DST). */
const localMin = (d: Date) => (((d.getTime() / 60_000 + 180) % 1440) + 1440) % 1440;
const hm = (h: number, m: number) => h * 60 + m;

describe('solar day (standard low-precision almanac)', () => {
  it('matches the published Baghdad almanac within a minute (8 Feb 2027: sunrise ≈ 06:53, sunset ≈ 17:40)', () => {
    const d = solarDay('2027-02-08', BAGHDAD, 18);
    expect(Math.abs(localMin(d.sunset) - hm(17, 40.4))).toBeLessThan(1);
    expect(Math.abs(localMin(d.sunrise) - hm(6, 53))).toBeLessThan(1);
  });

  it('matches the almanac at the other end of Ramadan 2027 too (1 and 14 Feb, 28 Feb sunsets 17:34, 17:46, 17:58)', () => {
    expect(Math.abs(localMin(solarDay('2027-02-01', BAGHDAD, 18).sunset) - hm(17, 34))).toBeLessThan(1);
    expect(Math.abs(localMin(solarDay('2027-02-14', BAGHDAD, 18).sunset) - hm(17, 46))).toBeLessThan(1);
    expect(Math.abs(localMin(solarDay('2027-02-28', BAGHDAD, 18).sunset) - hm(17, 58))).toBeLessThan(1);
  });

  it('fajr comes before sunrise and moves earlier as the sun dips further', () => {
    const d18 = solarDay('2027-02-08', AZIZIYAH, 18);
    const d16 = solarDay('2027-02-08', AZIZIYAH, 16);
    expect(d18.fajr.getTime()).toBeLessThan(d16.fajr.getTime());
    expect(d16.fajr.getTime()).toBeLessThan(d18.sunrise.getTime());
  });
});

describe('iftar times on both timetables (Aziziyah)', () => {
  it('1 Ramadan 1448 (≈ 8 Feb 2027): Sunni iftar 17:39, Shia 17:54, suhoor until 05:26', () => {
    const t = iftarTimes('2027-02-08', {});
    expect(formatHhMm(t.sunni.iftarAt)).toBe('17:39');
    expect(formatHhMm(t.shia.iftarAt)).toBe('17:54');
    expect(formatHhMm(t.sunni.fajrAt)).toBe('05:26');
    expect(formatHhMm(t.shia.fajrAt)).toBe('05:26');
    expect(t.sunni.overridden).toBe(false);
  });

  it('rounds iftar up and fajr down to the whole minute (never early to break, never late to stop)', () => {
    const sun = solarDay('2027-02-08', AZIZIYAH, 18);
    const t = iftarTimes('2027-02-08', {});
    expect(t.sunni.iftarAt.getTime()).toBeGreaterThanOrEqual(sun.sunset.getTime());
    expect(t.sunni.iftarAt.getTime() - sun.sunset.getTime()).toBeLessThan(60_000);
    expect(t.sunni.fajrAt.getTime()).toBeLessThanOrEqual(sun.fajr.getTime());
    expect(t.sunni.iftarAt.getUTCSeconds()).toBe(0);
    expect(t.sunni.fajrAt.getUTCSeconds()).toBe(0);
  });

  it("a period's Shia offset replaces the default; an ops override replaces one timetable's iftar on one day", () => {
    expect(formatHhMm(iftarTimes('2027-02-08', { shiaOffsetMin: 10 }).shia.iftarAt)).toBe('17:49');
    const t = iftarTimes('2027-02-08', { overrides: { '2027-02-08': { shia: '17:57' } } });
    expect(formatHhMm(t.shia.iftarAt)).toBe('17:57');
    expect(t.shia.overridden).toBe(true);
    expect(formatHhMm(t.sunni.iftarAt)).toBe('17:39');
    expect(formatHhMm(iftarTimes('2027-02-09', { overrides: { '2027-02-08': { shia: '17:57' } } }).shia.iftarAt)).not.toBe('17:57');
  });

  it('the last day of Ramadan 2027 (≈ 9 Mar): iftar later, fajr earlier', () => {
    const first = iftarTimes('2027-02-08', {});
    const last = iftarTimes('2027-03-09', {});
    expect(formatHhMm(last.sunni.iftarAt)).toBe('18:03');
    expect(localMin(last.sunni.fajrAt)).toBeLessThan(localMin(first.sunni.fajrAt));
  });
});
