import { describe, expect, it } from 'vitest';
import {
  askAt,
  atLocal,
  baghdadDate,
  baghdadWeekday,
  dinnerDeliverAt,
  dueReminders,
  isOccurrenceDate,
  nextOccurrence,
  occurrencesFrom,
  rideScheduleProblem,
  rideSearchStartsAt,
  SaveRegularTripInput,
  type OccurrenceDecision,
} from './ride-habits-io.js';

// Wednesday 7 Oct 2026, 18:00 Baghdad (15:00Z).
const WED_18 = new Date('2026-10-07T15:00:00Z');
const WORK = { days: [0, 1, 2, 3, 4], timeMin: 7 * 60 + 30, remind: 'evening' as const };

describe('Baghdad calendar', () => {
  it('reads the Baghdad date and weekday, not UTC', () => {
    expect(baghdadDate(new Date('2026-10-07T21:30:00Z'))).toBe('2026-10-08');
    expect(baghdadWeekday(new Date('2026-10-07T21:30:00Z'))).toBe(4); // Thursday
    expect(atLocal('2026-10-08', 7 * 60 + 30).toISOString()).toBe('2026-10-08T04:30:00.000Z');
  });
});

describe('rideScheduleProblem', () => {
  it('needs 20 minutes to 7 days ahead', () => {
    const at = (min: number) => new Date(WED_18.getTime() + min * 60_000);
    expect(rideScheduleProblem(at(19), WED_18)).toBe('too_soon');
    expect(rideScheduleProblem(at(20), WED_18)).toBeNull();
    expect(rideScheduleProblem(at(7 * 24 * 60), WED_18)).toBeNull();
    expect(rideScheduleProblem(at(7 * 24 * 60 + 1), WED_18)).toBe('too_far');
  });
  it('starts the search 15 minutes before', () => {
    expect(rideSearchStartsAt(new Date('2026-10-08T04:30:00Z')).toISOString()).toBe('2026-10-08T04:15:00.000Z');
  });
});

describe('regular trips', () => {
  it('asks at 20:00 the evening before, or 08:00 that morning', () => {
    expect(askAt('2026-10-08', 'evening').toISOString()).toBe('2026-10-07T17:00:00.000Z');
    expect(askAt('2026-10-08', 'morning').toISOString()).toBe('2026-10-08T05:00:00.000Z');
  });

  it('lists only the trip days', () => {
    const dates = occurrencesFrom(WORK, WED_18).map((o) => o.date);
    // Wed 7 (today), Thu 8, Sun 11, Mon 12, Tue 13, Wed 14 (Fri 9 and Sat 10 are off).
    expect(dates).toEqual(['2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
    expect(isOccurrenceDate(WORK, '2026-10-09')).toBe(false);
    expect(isOccurrenceDate(WORK, '2026-10-11')).toBe(true);
  });

  it('shows tomorrow as waiting before 20:00 and asking after', () => {
    expect(nextOccurrence(WORK, WED_18, new Map())).toMatchObject({ date: '2026-10-08', state: 'waiting' });
    const evening = new Date('2026-10-07T17:05:00Z');
    expect(nextOccurrence(WORK, evening, new Map())).toMatchObject({ date: '2026-10-08', state: 'asking' });
  });

  it('keeps a decided occurrence until it passes, then moves on', () => {
    const booked: OccurrenceDecision = { state: 'confirmed', orderId: 'o1', bookingId: null, demandId: null };
    const decisions = new Map([['2026-10-08', booked]]);
    expect(nextOccurrence(WORK, WED_18, decisions)).toMatchObject({ date: '2026-10-08', state: 'confirmed', orderId: 'o1' });
    const after = new Date('2026-10-08T05:00:00Z');
    expect(nextOccurrence(WORK, after, decisions)).toMatchObject({ date: '2026-10-11', state: 'waiting' });
  });

  it('passes over an unanswered occurrence less than 20 minutes away', () => {
    const late = new Date('2026-10-08T04:15:00Z'); // 07:15, the trip is 07:30
    expect(nextOccurrence(WORK, late, new Map())).toMatchObject({ date: '2026-10-11' });
  });

  it('reminds once the ask time has come, never for decided or closed ones', () => {
    const evening = new Date('2026-10-07T17:05:00Z');
    expect(dueReminders(WORK, evening, new Set())).toEqual([{ date: '2026-10-08', at: new Date('2026-10-08T04:30:00Z') }]);
    expect(dueReminders(WORK, evening, new Set(['2026-10-08']))).toEqual([]);
    expect(dueReminders(WORK, new Date('2026-10-08T04:20:00Z'), new Set())).toEqual([]);
    expect(dueReminders(WORK, WED_18, new Set())).toEqual([]);
  });

  it('refuses a morning reminder for a trip before 09:00', () => {
    const plan = { kind: 'rajaa' as const, corridorId: 'aziziyah_kut', direction: 'from_aziziyah' as const, garageId: 'mp_garage_bab1', travellingAs: 'rijal' as const };
    expect(SaveRegularTripInput.safeParse({ days: [4], timeMin: 8 * 60, remind: 'morning', plan }).success).toBe(false);
    expect(SaveRegularTripInput.safeParse({ days: [4], timeMin: 9 * 60, remind: 'morning', plan }).success).toBe(true);
    expect(SaveRegularTripInput.safeParse({ days: [4], timeMin: 7 * 60 + 33, remind: 'evening', plan }).success).toBe(false);
    expect(SaveRegularTripInput.parse({ days: [4, 0, 4], timeMin: 7 * 60, remind: 'evening', plan }).days).toEqual([0, 4]);
  });
});

describe('dinnerDeliverAt', () => {
  const arrive = new Date('2026-10-07T16:38:00Z');
  it('arrives with him when the kitchen can make it (rounded up to 5)', () => {
    expect(dinnerDeliverAt(arrive, new Date('2026-10-07T16:20:00Z'))).toEqual({ deliverAt: new Date('2026-10-07T16:40:00Z'), lateByMin: 0 });
  });
  it('comes after him when the kitchen needs longer, and says how much', () => {
    expect(dinnerDeliverAt(arrive, new Date('2026-10-07T16:47:00Z'))).toEqual({ deliverAt: new Date('2026-10-07T16:50:00Z'), lateByMin: 12 });
  });
});
