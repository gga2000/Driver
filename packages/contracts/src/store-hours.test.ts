import { describe, expect, it } from 'vitest';
import {
  daysFromWindows,
  scheduleState,
  storeHoursProblems,
  windowsFromDays,
  type DayHours,
} from './store-hours.js';

const TZ = 'Asia/Baghdad';
/** Baghdad local "YYYY-MM-DD HH:MM" → instant (UTC+3, no DST). */
const local = (s: string) => new Date(`${s.replace(' ', 'T')}:00+03:00`);

/** Lunch 12:00–15:30 and dinner 18:00–01:00 every day; Friday dinner only. */
function week(): DayHours[] {
  return Array.from({ length: 7 }, (_, dow) => ({
    dow,
    shifts:
      dow === 5
        ? [{ start: '18:00', end: '01:00' }]
        : [
            { start: '18:00', end: '01:00' },
            { start: '12:00', end: '15:30' },
          ],
  }));
}

describe('store hours', () => {
  it('accepts split shifts and a shift past midnight; round-trips through weekly windows', () => {
    const days = week();
    expect(storeHoursProblems(days)).toEqual([]);
    const windows = windowsFromDays(days);
    expect(windows.filter((w) => w.dow === 0)).toEqual([
      { dow: 0, start: '12:00', end: '15:30' },
      { dow: 0, start: '18:00', end: '01:00' },
    ]);
    expect(daysFromWindows(windows)[0]!.shifts.map((s) => s.start)).toEqual(['12:00', '18:00']);
    expect(daysFromWindows(windows)[5]!.shifts).toHaveLength(1);
  });

  it('flags overlapping shifts, also across midnight and Saturday → Sunday, and too-short ones', () => {
    const days = week();
    days[1]!.shifts = [
      { start: '12:00', end: '16:00' },
      { start: '15:00', end: '20:00' },
      { start: '21:00', end: '01:00' },
    ];
    days[2]!.shifts = [{ start: '00:30', end: '03:00' }]; // Monday's 18:00–01:00 runs into it
    days[6]!.shifts = [{ start: '20:00', end: '02:00' }];
    days[0]!.shifts = [
      { start: '01:00', end: '05:00' },
      { start: '12:00', end: '12:10' },
    ]; // Saturday night runs to 02:00
    const codes = storeHoursProblems(days).map((p) => `${p.code}:${'dow' in p ? p.dow : ''}`);
    expect(codes).toContain('shift_overlap:1');
    expect(codes).toContain('shift_overlap:2');
    expect(codes).toContain('shift_overlap:0');
    expect(codes).toContain('shift_too_short:0');
  });

  it('needs at least one open day (closing every day is the early-close switch)', () => {
    expect(
      storeHoursProblems(Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: [] }))),
    ).toEqual([{ code: 'no_open_day' }]);
  });

  it('checks holiday closures: in order and at most a month', () => {
    expect(
      storeHoursProblems(week(), [
        { from: '2026-10-10', to: '2026-10-09', note: null },
        { from: '2026-10-01', to: '2026-11-15', note: null },
        { from: '2026-10-20', to: '2026-10-22', note: 'عيد' },
      ]).map((p) => p.code),
    ).toEqual(['holiday_order', 'holiday_too_long']);
  });

  it('knows open, closed between shifts, the small hours after midnight, and the next opening', () => {
    const w = windowsFromDays(week());
    // 2026-10-04 is a Sunday.
    expect(scheduleState(local('2026-10-04 13:00'), w, [], TZ)).toMatchObject({
      inHours: true,
      closesAt: '15:30',
    });
    expect(scheduleState(local('2026-10-04 16:00'), w, [], TZ)).toMatchObject({
      inHours: false,
      opensAt: { date: '2026-10-04', time: '18:00', dow: 0 },
    });
    expect(scheduleState(local('2026-10-05 00:40'), w, [], TZ)).toMatchObject({
      inHours: true,
      closesAt: '01:00',
    });
    expect(scheduleState(local('2026-10-05 02:00'), w, [], TZ)).toMatchObject({
      inHours: false,
      opensAt: { date: '2026-10-05', time: '12:00' },
    });
    // Friday: dinner only.
    expect(scheduleState(local('2026-10-09 12:30'), w, [], TZ)).toMatchObject({
      inHours: false,
      opensAt: { date: '2026-10-09', time: '18:00' },
    });
  });

  it('a holiday closes the day (and its small hours) and the next opening skips it', () => {
    const w = windowsFromDays(week());
    const eid = [{ from: '2026-10-05', to: '2026-10-06', note: 'عيد' }];
    const s = scheduleState(local('2026-10-05 13:00'), w, eid, TZ);
    expect(s).toMatchObject({
      inHours: false,
      holiday: { note: 'عيد' },
      opensAt: { date: '2026-10-07', time: '12:00', dow: 3 },
    });
    // Sunday's dinner runs into Monday 00:30: Sunday is not a holiday, so it stays open.
    expect(scheduleState(local('2026-10-05 00:30'), w, eid, TZ).inHours).toBe(true);
    // Tuesday 00:30 belongs to Monday's dinner (a holiday): closed.
    expect(scheduleState(local('2026-10-07 00:30'), w, eid, TZ).inHours).toBe(false);
  });

  it('no hours on file is always open, except on a holiday (reopens at midnight after it)', () => {
    expect(scheduleState(local('2026-10-04 04:00'), [], [], TZ).inHours).toBe(true);
    expect(
      scheduleState(
        local('2026-10-04 04:00'),
        [],
        [{ from: '2026-10-04', to: '2026-10-04', note: null }],
        TZ,
      ),
    ).toMatchObject({ inHours: false, opensAt: { date: '2026-10-05', time: '00:00' } });
  });
});
