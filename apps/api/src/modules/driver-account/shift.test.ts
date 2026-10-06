import { describe, expect, it } from 'vitest';
import { bestHour, busiestWindow, clampShift, perHour, startOfLocalHour, tomorrowAndLastWeek } from './shift.js';

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

  it('per hour: net over online time, in 250 steps; null under 30 minutes', () => {
    expect(perHour(15_000, 240)).toBe(3_750);
    expect(perHour(10_000, 180)).toBe(3_250); // 3,333 → 3,250
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
