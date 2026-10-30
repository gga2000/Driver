import { describe, expect, it } from 'vitest';
import { waitClockState, type WaitClockValue } from './WaitClock';

const start = new Date('2026-10-08T08:00:00Z');
const at = (min: number) => new Date(start.getTime() + min * 60_000);
const clock = (over: Partial<WaitClockValue> = {}): WaitClockValue => ({ startedAt: start, endedAt: null, includedHours: 4, extraHourIqd: 5_000, freeMin: 15, charged: true, ...over });

describe('the waiting clock (w2–w4)', () => {
  it('walks through included, the 10-minute reminder, the free minutes and the extra hours', () => {
    expect(waitClockState(clock(), at(60)).phase).toBe('included');
    expect(waitClockState(clock(), at(229)).phase).toBe('included');
    expect(waitClockState(clock(), at(230))).toMatchObject({ phase: 'ending', leftMin: 10 });
    expect(waitClockState(clock(), at(250))).toMatchObject({ phase: 'grace', overMin: 10, extraHours: 0, extraIqd: 0 });
    expect(waitClockState(clock(), at(310))).toMatchObject({ phase: 'extra', extraHours: 1, extraIqd: 5_000 });
    expect(waitClockState(clock(), at(320))).toMatchObject({ extraHours: 2, extraIqd: 10_000 });
  });

  it('shows no money while the charge is off, and stops counting once the rider is back', () => {
    expect(waitClockState(clock({ charged: false }), at(320))).toMatchObject({ phase: 'extra', extraHours: 2, extraIqd: 0 });
    const done = waitClockState(clock({ endedAt: at(200) }), at(900));
    expect(done).toMatchObject({ phase: 'done', waitedMin: 200, overMin: 0, extraIqd: 0 });
  });
});
