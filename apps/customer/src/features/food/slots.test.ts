import { describe, expect, it } from 'vitest';
import { formatClock } from '@driver/i18n';
import { firstOpenSlot, insideHours, preorderSlots } from './slots';

const daily = (start: string, end: string) => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start, end }));
/** Breakfast kitchen: 5:00–15:00 every day (مطعم المسافر). */
const BREAKFAST = daily('05:00', '15:00');
const clocks = (ds: Date[]) => ds.map((d) => formatClock(d, { period: false }));

describe('insideHours', () => {
  it('a plain window and one that runs past midnight; the opening minute counts', () => {
    expect(insideHours(2, 5 * 60, BREAKFAST)).toBe(true);
    expect(insideHours(2, 15 * 60, BREAKFAST)).toBe(false);
    const late = [{ dow: 2, start: '11:00', end: '00:30' }];
    expect(insideHours(2, 23 * 60 + 30, late)).toBe(true);
    expect(insideHours(3, 15, late)).toBe(true);
    expect(insideHours(3, 45, late)).toBe(false);
    expect(insideHours(4, 0, [])).toBe(true);
  });
});

describe('preorderSlots (o11): today and tomorrow, inside the hours', () => {
  // Tuesday 2026-10-06, 21:10 in Baghdad: the breakfast kitchen closed at 15:00.
  const night = new Date('2026-10-06T18:10:00Z');
  it('nothing more today; tomorrow starts at the opening', () => {
    expect(preorderSlots(night, BREAKFAST, 0)).toEqual([]);
    expect(clocks(preorderSlots(night, BREAKFAST, 1, { count: 3 }))).toEqual(['5:00', '5:30', '6:00']);
    expect(firstOpenSlot(night, BREAKFAST)).toMatchObject({ day: 1 });
  });
  it('today: at least 45 minutes away, on the half hour, until closing', () => {
    const morning = new Date('2026-10-06T10:20:00Z'); // 13:20 local
    expect(clocks(preorderSlots(morning, BREAKFAST, 0))).toEqual(['2:30']);
  });
  it('no hours on file: every half hour after the lead', () => {
    const at = new Date('2026-10-06T16:00:00Z'); // 19:00 local
    expect(clocks(preorderSlots(at, [], 0, { count: 3 }))).toEqual(['8:00', '8:30', '9:00']);
  });
});

describe('preorderSlots: pause windows (Friday prayer) are skipped', () => {
  const PRAYER = [{ dow: 5, start: '11:45', end: '13:15' }];
  // Thursday 2026-10-08 21:00 Baghdad: Friday's slots from 11:00.
  const thursdayNight = new Date('2026-10-08T18:00:00Z');
  it('no slot inside the pause; the first after it is 13:30', () => {
    const lunch = daily('11:00', '23:00');
    expect(clocks(preorderSlots(thursdayNight, lunch, 1, { count: 4, pauses: PRAYER }))).toEqual(['11:00', '11:30', '1:30', '2:00']);
  });
});
