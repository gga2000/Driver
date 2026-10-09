import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n-core';
import type { TKey } from '@/lib/i18n-core';
import {
  addHoliday,
  addShift,
  copyToAll,
  crossesMidnight,
  draftProblems,
  holidayDays,
  problemText,
  removeShift,
  sameDraft,
  scheduleBanner,
  setDayOpen,
  shiftLabel,
  stateLine,
  timeChoices,
  timeLabel,
  updateShift,
  WEEK_ORDER,
  type HoursDraft,
} from './logic';

const t = (k: TKey, p?: Record<string, string | number>) => translate(k, p, 'ar-IQ');
const dayMonth = (d: string) => d;

function week(): HoursDraft {
  return {
    days: Array.from({ length: 7 }, (_, dow) => ({
      dow,
      shifts: [{ start: '12:00', end: '23:00' }],
    })),
    holidays: [],
  };
}

describe('hours editor', () => {
  it('says times the way a kitchen does, and shifts past midnight', () => {
    expect(timeLabel(t, '12:00')).toBe('12 الظهر');
    expect(timeLabel(t, '15:30')).toBe('3:30 العصر');
    expect(timeLabel(t, '18:00')).toBe('6 المغرب');
    expect(timeLabel(t, '01:00')).toBe('1 بالليل');
    expect(shiftLabel(t, { start: '18:00', end: '01:00' })).toBe('\u20676 المغرب – 1 بالليل\u2069');
    expect(shiftLabel(t, { start: '18:00', end: '01:00' }, 'en')).toMatch(/^\u2066.* – .*\u2069$/);
    expect(crossesMidnight({ start: '18:00', end: '01:00' })).toBe(true);
    expect(crossesMidnight({ start: '18:00', end: '00:00' })).toBe(false);
    expect(timeChoices(60)[0]).toBe('06:00');
    expect(timeChoices(60)).toHaveLength(24);
    expect(WEEK_ORDER[0]).toBe(6);
  });

  it('splits a day into lunch and dinner, closes and reopens a day with its shifts', () => {
    let d = updateShift(week(), 0, 0, { end: '15:30' });
    d = addShift(d, 0);
    expect(d.days[0]!.shifts).toEqual([
      { start: '12:00', end: '15:30' },
      { start: '16:30', end: '20:30' },
    ]);
    d = updateShift(d, 0, 1, { start: '18:00', end: '01:00' });
    expect(draftProblems(d)).toEqual([]);
    // Three shifts at most.
    expect(addShift(addShift(d, 0), 0).days[0]!.shifts).toHaveLength(3);
    const closed = setDayOpen(d, 0, false);
    expect(closed.days[0]!.shifts).toEqual([]);
    expect(setDayOpen(closed, 0, true, d.days[0]!.shifts).days[0]!.shifts).toHaveLength(2);
    expect(setDayOpen(closed, 0, true).days[0]!.shifts).toEqual([{ start: '12:00', end: '23:00' }]);
    expect(removeShift(d, 0, 0).days[0]!.shifts).toEqual([{ start: '18:00', end: '01:00' }]);
    expect(copyToAll(d, 0).days.every((x) => x.shifts.length === 2)).toBe(true);
  });

  it('flags overlaps (also into the next morning) and a week with no open day, in Iraqi words', () => {
    let d = updateShift(week(), 1, 0, { start: '18:00', end: '03:00' });
    d = updateShift(d, 2, 0, { start: '02:00', end: '05:00' });
    const problems = draftProblems(d);
    expect(problems.map((p) => problemText(t, p))).toContain('فترتين متداخلة يوم الثلاثاء');
    const none = { ...week(), days: week().days.map((x) => ({ ...x, shifts: [] })) };
    expect(problemText(t, draftProblems(none)[0]!)).toContain('لازم يوم واحد مفتوح');
  });

  it('adds holidays in order (reversed picks are fixed) and counts their days', () => {
    let d = addHoliday(week(), { from: '2026-10-22', to: '2026-10-20', note: ' عيد ' });
    d = addHoliday(d, { from: '2026-10-10', to: '2026-10-10', note: '' });
    expect(d.holidays).toEqual([
      { from: '2026-10-10', to: '2026-10-10', note: null },
      { from: '2026-10-20', to: '2026-10-22', note: 'عيد' },
    ]);
    expect(holidayDays(d.holidays[1]!)).toBe(3);
    expect(sameDraft(d, { ...d, holidays: [...d.holidays].reverse() })).toBe(true);
    expect(sameDraft(d, week())).toBe(false);
  });

  it('the status line and the board strip explain why customers cannot order', () => {
    const base = {
      today: '2026-10-04',
      holidays: [{ from: '2026-10-04', to: '2026-10-06', note: 'عيد' }],
    };
    expect(
      stateLine(
        t,
        { ...base, state: { open: true, reason: null, closesAt: '01:00', opensAt: null } },
        dayMonth,
      ),
    ).toBe('مفتوح لحد 1 بالليل');
    expect(
      stateLine(
        t,
        {
          ...base,
          state: {
            open: false,
            reason: 'hours',
            closesAt: null,
            opensAt: { date: '2026-10-04', dow: 0, time: '18:00' },
          },
        },
        dayMonth,
      ),
    ).toBe('برّا وقت الدوام · يفتح اليوم 6 المغرب');
    expect(
      stateLine(
        t,
        {
          ...base,
          state: {
            open: false,
            reason: 'holiday',
            closesAt: null,
            opensAt: { date: '2026-10-07', dow: 3, time: '12:00' },
          },
        },
        dayMonth,
      ),
    ).toBe('عطلة لحد 2026-10-06 · يفتح الأربعاء 12 الظهر');
    expect(
      scheduleBanner(
        t,
        {
          inHours: false,
          holiday: null,
          closesAt: null,
          opensAt: { date: '2026-10-05', dow: 1, time: '12:00' },
        },
        '2026-10-04',
        dayMonth,
      ),
    ).toBe('برّا وقت الدوام: الزباين ما يگدرون يطلبون. المحل يفتح باچر 12 الظهر');
    expect(
      scheduleBanner(
        t,
        { inHours: true, holiday: null, closesAt: '23:00', opensAt: null },
        '2026-10-04',
        dayMonth,
      ),
    ).toBeNull();
    expect(scheduleBanner(t, null, '2026-10-04', dayMonth)).toBeNull();
  });
});
