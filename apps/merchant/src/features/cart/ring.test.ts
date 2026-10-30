import { describe, expect, it } from 'vitest';
import { emptyRing, FRESH_MS, freshIds, ringStep, WALKUP_RINGS_MS, type RingState } from './ring';

/** Runs a step and returns the new state plus whether it chimed. */
function step(state: RingState, waiting: string[], now: number) {
  return ringStep(state, waiting, now);
}

describe('walk-over ticket ring', () => {
  it('rings at 0, 30 s and 60 s, and wears «جديدة» for 90 s', () => {
    expect(WALKUP_RINGS_MS).toEqual([0, 30_000, 60_000]);
    expect(FRESH_MS).toBe(90_000);
  });

  it('the first step marks tickets already there as old and does not chime', () => {
    const first = step(emptyRing(), ['w1', 'w2'], 1_000);
    expect(first.chime).toBe(false);
    expect(first.state.started).toBe(true);
    expect(first.state.seen.get('w1')?.old).toBe(true);
    // Old tickets never ring later either.
    let s = first.state;
    for (const t of [31_000, 61_000, 120_000]) {
      const r = step(s, ['w1', 'w2'], t);
      expect(r.chime).toBe(false);
      s = r.state;
    }
  });

  it('a first step with nothing waiting still starts the screen', () => {
    const r = step(emptyRing(), [], 0);
    expect(r.chime).toBe(false);
    expect(r.state.started).toBe(true);
  });

  it('a new ticket chimes at 0, 30 s and 60 s, then stops', () => {
    let s = step(emptyRing(), [], 0).state;
    const at = 10_000;
    const chimes: number[] = [];
    for (let t = at; t <= at + 180_000; t += 5_000) {
      const r = step(s, ['w9'], t);
      if (r.chime) chimes.push(t - at);
      s = r.state;
    }
    expect(chimes).toEqual([0, 30_000, 60_000]);
  });

  it('does not chime between the due times', () => {
    let s = step(emptyRing(), [], 0).state;
    s = step(s, ['w1'], 1_000).state;
    const mid = step(s, ['w1'], 1_000 + 29_999);
    expect(mid.chime).toBe(false);
  });

  it('several chimes due at once play as one, never a burst', () => {
    let s = step(emptyRing(), [], 0).state;
    s = step(s, ['w1'], 1_000).state; // chime at 0
    const late = step(s, ['w1'], 1_000 + 65_000); // both 30 s and 60 s are due
    expect(late.chime).toBe(true);
    expect(late.state.seen.get('w1')?.rung).toBe(WALKUP_RINGS_MS.length);
    expect(step(late.state, ['w1'], 1_000 + 200_000).chime).toBe(false);
  });

  it('a ticket that leaves the waiting list drops out', () => {
    let s = step(emptyRing(), [], 0).state;
    s = step(s, ['w1', 'w2'], 1_000).state;
    const r = step(s, ['w2'], 31_000);
    expect(r.state.seen.has('w1')).toBe(false);
    expect(r.state.seen.has('w2')).toBe(true);
    // w2 still rings on its own schedule.
    expect(r.chime).toBe(true);
  });

  it('nothing waiting means no chime', () => {
    let s = step(emptyRing(), [], 0).state;
    s = step(s, ['w1'], 1_000).state;
    expect(step(s, [], 31_000).chime).toBe(false);
  });
});

describe('freshIds («جديدة»)', () => {
  it('holds tickets that came in under 90 s ago and never the old ones', () => {
    let s = step(emptyRing(), ['old'], 0).state;
    s = step(s, ['old', 'new'], 10_000).state;
    expect([...freshIds(s, 10_000)]).toEqual(['new']);
    expect([...freshIds(s, 10_000 + FRESH_MS - 1)]).toEqual(['new']);
    expect(freshIds(s, 10_000 + FRESH_MS).size).toBe(0);
  });

  it('is empty before anything came in', () => {
    expect(freshIds(emptyRing(), 0).size).toBe(0);
  });
});
