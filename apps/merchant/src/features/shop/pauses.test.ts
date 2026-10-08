import { describe, expect, it } from 'vitest';
import { endOfDayClose, nextDayOpening, pauseMinutesUntil, prayerEnd, quickPauses } from './pauses';

const NOTES = { friday: 'صلاة الجمعة', prayer: 'صلاة' };
const week = (shifts: { start: string; end: string }[], closed: number[] = []) => Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: closed.includes(dow) ? [] : shifts }));
const HOURS = { source: 'store' as const, days: week([{ start: '12:00', end: '00:00' }]), pauses: [{ dow: 5, start: '12:00', end: '13:15', reason: 'friday_prayer' }] };

// Friday 9 Oct 2026, 11:40 Baghdad.
const FRIDAY = Date.parse('2026-10-09T08:40:00Z');
// Wednesday 7 Oct 2026, 22:10 Baghdad.
const WEDNESDAY = Date.parse('2026-10-07T19:10:00Z');

describe('quick pauses', () => {
  it('Friday prayer runs to the end of the city window; other days it is 15 minutes', () => {
    expect(prayerEnd(HOURS, FRIDAY)).toBe(Date.parse('2026-10-09T10:15:00Z'));
    const [prayer] = quickPauses(HOURS, FRIDAY, NOTES);
    expect(prayer).toMatchObject({ id: 'prayer', reason: 'other', note: 'صلاة الجمعة', minutes: 95, friday: true });
    // After the window the same chip is a short prayer.
    const after = Date.parse('2026-10-09T10:30:00Z');
    expect(prayerEnd(HOURS, after)).toBeNull();
    expect(quickPauses(HOURS, after, NOTES)[0]).toMatchObject({ note: 'صلاة', minutes: 15 });
    expect(quickPauses(HOURS, WEDNESDAY, NOTES)[0]!.friday).toBeUndefined();
  });

  it('a power cut is 20 minutes, sold out lasts until tomorrow opens', () => {
    const [, power, soldOut] = quickPauses(HOURS, WEDNESDAY, NOTES);
    expect(power).toMatchObject({ reason: 'power_cut', minutes: 20 });
    // Thursday 12:00 Baghdad.
    expect(nextDayOpening(HOURS, WEDNESDAY)).toBe(Date.parse('2026-10-08T09:00:00Z'));
    expect(soldOut).toMatchObject({ reason: 'sold_out', minutes: 830, until: Date.parse('2026-10-08T09:00:00Z') });
  });

  it('skips closed days, and falls back to «until opened» when tomorrow is too far or unknown', () => {
    const thursdayOff = { ...HOURS, days: week([{ start: '12:00', end: '00:00' }], [4]) };
    // Next opening is Friday noon: 37 h 50 min away, past what a pause may last.
    expect(nextDayOpening(thursdayOff, WEDNESDAY)).toBe(Date.parse('2026-10-09T09:00:00Z'));
    expect(quickPauses(thursdayOff, WEDNESDAY, NOTES)[2]).toMatchObject({ minutes: null, until: null });
    expect(quickPauses({ ...HOURS, source: 'none' }, WEDNESDAY, NOTES)[2]!.minutes).toBeNull();
    expect(quickPauses(undefined, WEDNESDAY, NOTES)[2]!.minutes).toBeNull();
  });

  it('keeps lengths inside what the server takes', () => {
    expect(pauseMinutesUntil(WEDNESDAY + 4 * 60_000, WEDNESDAY)).toBeNull();
    expect(pauseMinutesUntil(WEDNESDAY + 5 * 60_000, WEDNESDAY)).toBe(5);
    expect(pauseMinutesUntil(WEDNESDAY + 36 * 3_600_000, WEDNESDAY)).toBe(2160);
    expect(pauseMinutesUntil(WEDNESDAY + 36 * 3_600_000 + 60_000, WEDNESDAY)).toBeNull();
  });
});

describe('«عاشت إيدك» at closing', () => {
  it('only when the day is done', () => {
    expect(endOfDayClose('closing_early', null, Date.parse('2026-10-07T10:00:00Z'))).toBe(true);
    expect(endOfDayClose('other', null, WEDNESDAY)).toBe(true);
    expect(endOfDayClose('no_staff', null, Date.parse('2026-10-07T10:00:00Z'))).toBe(false);
    expect(endOfDayClose('closing_early', 30, WEDNESDAY)).toBe(false);
  });
});
