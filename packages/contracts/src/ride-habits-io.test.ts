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
  decodeRideEnd,
  encodeRideEnd,
  isWorkDay,
  rideReminderAt,
  rideScheduleProblem,
  rideSearchStartsAt,
  sameRideHabits,
  sameRidePushWindow,
  SaveRegularTripInput,
  workDaysBefore,
  type OccurrenceDecision,
  type RideFootprint,
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
  it('takes the 5-minute grid only', () => {
    expect(rideScheduleProblem(new Date('2026-10-08T04:35:00Z'), WED_18)).toBeNull();
    expect(rideScheduleProblem(new Date('2026-10-08T04:33:00Z'), WED_18)).toBe('off_grid');
    expect(rideScheduleProblem(new Date('2026-10-08T04:35:30Z'), WED_18)).toBe('off_grid');
  });
  it('reminds half an hour before, unless that is within half an hour of booking', () => {
    expect(rideReminderAt(new Date('2026-10-08T04:00:00Z'), WED_18)?.toISOString()).toBe('2026-10-08T03:30:00.000Z');
    const booked = new Date('2026-10-08T03:00:00Z');
    expect(rideReminderAt(new Date('2026-10-08T04:00:00Z'), booked)?.toISOString()).toBe('2026-10-08T03:30:00.000Z');
    expect(rideReminderAt(new Date('2026-10-08T03:55:00Z'), booked)).toBeNull();
  });
});

describe('«نفس مشوار البارحة؟» (step 4, o4)', () => {
  const HOME = { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 }, placeId: 'pl_home' };
  const SCHOOL = { zoneKey: 'street_30', pin: { lat: 32.92, lng: 45.07 } };
  const ride = (orderId: string, at: string, over: Partial<RideFootprint> = {}): RideFootprint => ({ orderId, vertical: 'taxi', doorPickup: false, pickup: HOME, dropoff: SCHOOL, at: new Date(at), ...over });
  // Mon 5, Tue 6, Wed 7 Oct at 7:25, 7:30 and 7:45 Baghdad.
  const WEEK = [ride('mon', '2026-10-05T04:25:00Z'), ride('tue', '2026-10-06T04:30:00Z'), ride('wed', '2026-10-07T04:45:00Z', { vertical: 'tuktuk', doorPickup: true })];

  it('works Sunday to Thursday; looks back over working days only', () => {
    expect(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].map(isWorkDay)).toEqual([true, false, false, true]);
    expect(workDaysBefore('2026-10-11', 4)).toEqual(['2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05']);
  });

  it('finds the ride on 3 of the last 4 working days, timed at their middle, as he took it last', () => {
    expect(sameRideHabits(WEEK, '2026-10-08')).toEqual([
      { vertical: 'tuktuk', doorPickup: true, pickup: HOME, dropoff: SCHOOL, timeMin: 7 * 60 + 30, dates: ['2026-10-07', '2026-10-06', '2026-10-05'] },
    ]);
    expect(sameRidePushWindow({ timeMin: 450 }, '2026-10-08')).toEqual({ from: new Date('2026-10-08T04:20:00Z'), until: new Date('2026-10-08T04:27:00Z'), at: new Date('2026-10-08T04:30:00Z') });
  });

  it('needs the last working day, three days, the same ends within 200 m and the time within 20 minutes', () => {
    expect(sameRideHabits(WEEK.slice(1), '2026-10-08')).toEqual([]);
    expect(sameRideHabits(WEEK, '2026-10-09')).toEqual([]); // Friday
    expect(sameRideHabits(WEEK, '2026-10-12')).toEqual([]); // Monday: Thursday had none
    expect(sameRideHabits([...WEEK.slice(0, 2), ride('wed', '2026-10-07T04:55:00Z')], '2026-10-08')).toEqual([]); // 7:55 is 30 min from 7:25
    expect(sameRideHabits([...WEEK.slice(0, 2), ride('wed', '2026-10-07T04:30:00Z', { dropoff: { zoneKey: 'street_30', pin: { lat: 32.923, lng: 45.07 } } })], '2026-10-08')).toEqual([]);
    expect(sameRideHabits([...WEEK.slice(0, 2), ride('wed', '2026-10-07T04:30:00Z', { dropoff: { zoneKey: 'street_30', pin: { lat: 32.921, lng: 45.07 } } })], '2026-10-08')).toHaveLength(1);
  });

  it('keeps the way there and the way back apart, and counts one ride a day', () => {
    const back = (orderId: string, at: string) => ride(orderId, at, { pickup: { zoneKey: SCHOOL.zoneKey, pin: SCHOOL.pin }, dropoff: HOME });
    const days = [...WEEK, back('mon_b', '2026-10-05T10:00:00Z'), back('tue_b', '2026-10-06T10:05:00Z'), back('wed_b', '2026-10-07T10:00:00Z'), ride('wed2', '2026-10-07T04:35:00Z')];
    expect(sameRideHabits(days, '2026-10-08').map((h) => [h.timeMin, h.dates.length])).toEqual([
      [7 * 60 + 30, 3],
      [13 * 60, 3],
    ]);
  });

  it('round-trips the ends through the deep link', () => {
    expect(encodeRideEnd(HOME)).toBe('32.910000,45.060000,centre,pl_home');
    expect(decodeRideEnd(encodeRideEnd(HOME))).toEqual(HOME);
    expect(decodeRideEnd(encodeRideEnd(SCHOOL))).toEqual(SCHOOL);
    expect(decodeRideEnd('91,45,centre')).toBeNull();
    expect(decodeRideEnd('32.9,45.0,Centre;drop')).toBeNull();
    expect(decodeRideEnd(undefined)).toBeNull();
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
