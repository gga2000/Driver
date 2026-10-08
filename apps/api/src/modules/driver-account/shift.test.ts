import { describe, expect, it } from 'vitest';
import { bestDay, bestHour, bestWindow, busiestWindow, clampShift, perHour, startOfLocalHour, straightLineKm, tomorrowAndLastWeek } from './shift.js';

const job = (iso: string, netIqd: number, orderId: string | null = `o-${iso}`) => ({ at: new Date(iso), netIqd, tripId: null, orderId });

describe('end of shift (Partner S-4): window, per hour, best hour, tomorrow', () => {
  it('clamps the window: never in the future, never longer than 24 h, defaults to the Baghdad day', () => {
    const now = new Date('2026-10-05T17:00:00Z'); // 20:00 Baghdad
    // Default: Baghdad midnight (21:00Z the day before) → now.
    expect(clampShift({}, now)).toEqual({ from: new Date('2026-10-04T21:00:00Z'), to: now });
    // A `to` after now is pulled back; a `from` after `to` collapses to `to`.
    expect(clampShift({ from: new Date('2026-10-05T18:00:00Z'), to: new Date('2026-10-05T19:00:00Z') }, now)).toEqual({ from: now, to: now });
    // A start more than 24 h back is cut to the last 24 h (a stale onlineSince never runs on for days).
    expect(clampShift({ from: new Date('2026-10-04T10:00:00Z') }, now).from.toISOString()).toBe('2026-10-04T17:00:00.000Z');
    // A shift across midnight keeps its start (the window is not cut at the day boundary).
    const late = new Date('2026-10-05T22:30:00Z'); // 01:30 Baghdad
    expect(clampShift({ from: new Date('2026-10-05T17:00:00Z') }, late).from.toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });

  it('per hour: net over the exact online minutes, to the nearest 50; null under 30 minutes', () => {
    expect(perHour(15_000, 240)).toBe(3_750);
    expect(perHour(10_000, 180)).toBe(3_350); // 3,333 → 3,350
    // The review case: 11,500 from 7:49 to 12:50 (301 min) is 2,292 an hour → ≈ 2,300, not 2,250.
    expect(perHour(11_500, 301)).toBe(2_300);
    expect(perHour(7_400, 240)).toBe(1_850);
    expect(perHour(5_000, 29)).toBeNull();
    expect(perHour(0, 120)).toBe(0);
  });

  it('best hour: by Baghdad clock hour, real jobs only, ties to the earlier hour', () => {
    expect(startOfLocalHour(new Date('2026-10-05T10:59:00Z')).toISOString()).toBe('2026-10-05T10:00:00.000Z');
    const best = bestHour([
      job('2026-10-05T10:10:00Z', 1_500), // 13:10 Baghdad
      job('2026-10-05T10:40:00Z', 2_000), // 13:40 → the 1–2 م hour has 3,500
      job('2026-10-05T16:05:00Z', 3_500), // 19:05 → ties at 3,500: the earlier hour wins
      { at: new Date('2026-10-05T16:30:00Z'), netIqd: 9_000, tripId: null, orderId: null }, // an adjustment: not a job
    ]);
    expect(best).toEqual({ from: new Date('2026-10-05T10:00:00Z'), to: new Date('2026-10-05T11:00:00Z'), netIqd: 3_500, jobs: 2 });
    expect(bestHour([])).toBeNull();
  });

  it("tomorrow's busiest two hours from the same weekday last week (Baghdad days)", () => {
    const now = new Date('2026-10-05T20:30:00Z'); // Mon 23:30 Baghdad → tomorrow is Tue 6 Oct
    const { tomorrow, lastWeekFrom, lastWeekTo } = tomorrowAndLastWeek(now);
    expect(tomorrow.toISOString()).toBe('2026-10-05T21:00:00.000Z'); // Tue 00:00 Baghdad
    expect(lastWeekFrom.toISOString()).toBe('2026-09-28T21:00:00.000Z'); // Tue 29 Sep 00:00 Baghdad
    expect(lastWeekTo.toISOString()).toBe('2026-09-29T21:00:00.000Z');
    // Just after Baghdad midnight (21:30Z is 00:30 Tue): tomorrow is Wednesday.
    expect(tomorrowAndLastWeek(new Date('2026-10-05T21:30:00Z')).tomorrow.toISOString()).toBe('2026-10-06T21:00:00.000Z');

    const counts = new Array<number>(24).fill(0);
    counts[13] = 5;
    counts[14] = 3;
    counts[19] = 4;
    counts[20] = 4; // 19–21 has 8, 13–15 has 8: the earlier wins
    expect(busiestWindow(counts, tomorrow)).toEqual({ from: new Date('2026-10-06T10:00:00Z'), to: new Date('2026-10-06T12:00:00Z'), orders: 8 });
    expect(busiestWindow(new Array<number>(24).fill(0).map((_, h) => (h === 9 ? 2 : 0)), tomorrow)).toBeNull();
  });
});

describe('his best (partner redesign e3 / e4) and «يومك» km (e7)', () => {
  // Baghdad = UTC+3: 16:00Z is 19:00 local. 1 and 8 October 2026 are Thursdays.
  const thursdayNight = [
    job('2026-10-01T16:10:00Z', 3_000),
    job('2026-10-01T17:20:00Z', 2_500),
    job('2026-10-01T19:40:00Z', 3_500),
    job('2026-10-08T16:30:00Z', 3_000),
    job('2026-10-08T18:05:00Z', 2_000),
  ];

  it('best time: the weekday hours that paid most, edges trimmed, per hour over the four weeks', () => {
    const w = bestWindow([...thursdayNight, job('2026-10-04T06:00:00Z', 1_000)], 28);
    // Thursday (4) 19:00–23:00: 14,000 over 4 h × 4 Thursdays = 875 → 900 (nearest 50).
    expect(w).toEqual({ weekday: 4, fromHour: 19, toHour: 23, perHourIqd: 900, jobs: 5, days: 2 });
  });

  it('best time trims hours that earned little off the 4-hour window, never below 2 hours', () => {
    const w = bestWindow([job('2026-10-01T16:10:00Z', 5_000), job('2026-10-01T17:10:00Z', 5_000), job('2026-10-08T16:20:00Z', 5_000), job('2026-10-08T17:30:00Z', 4_000)], 28);
    expect(w).toMatchObject({ weekday: 4, fromHour: 19, toHour: 21, jobs: 4, days: 2 });
  });

  it('best time is a habit: null with fewer than 4 jobs or all on one night', () => {
    expect(bestWindow(thursdayNight.slice(0, 3), 28)).toBeNull();
    expect(bestWindow([job('2026-10-01T16:10:00Z', 3_000), job('2026-10-01T16:40:00Z', 3_000), job('2026-10-01T17:10:00Z', 3_000), job('2026-10-01T18:10:00Z', 3_000)], 28)).toBeNull();
    // Adjustments (no trip, no order) never make a best time.
    expect(bestWindow([...thursdayNight.map((j) => ({ ...j, orderId: null }))], 28)).toBeNull();
  });

  it('best day: the Baghdad day with the most net, tips and adjustments counted, jobs only from real jobs', () => {
    const d = bestDay([...thursdayNight, job('2026-10-01T20:30:00Z', 1_000, null)]);
    // 1 Oct local: 3,000 + 2,500 + 3,500 + 1,000 adjustment (23:30 local, same day).
    expect(d).toEqual({ at: new Date('2026-09-30T21:00:00Z'), netIqd: 10_000, jobs: 3 });
    expect(bestDay([])).toBeNull();
  });

  it('«يومك» km: straight lines between each trip\'s pinned stops, rounded down; null without a leg', () => {
    const a = { lat: 32.91, lng: 45.06 };
    const b = { lat: 32.92, lng: 45.06 }; // ≈ 1.1 km north
    const c = { lat: 32.92, lng: 45.08 }; // ≈ 1.9 km east of b
    expect(straightLineKm([{ stops: [{ target: a }, { target: b }] }, { stops: [{ target: b }, { target: null }, { target: c }] }])).toBe(3);
    expect(straightLineKm([{ stops: [{ target: a }] }])).toBeNull();
    expect(straightLineKm([])).toBeNull();
  });
});
