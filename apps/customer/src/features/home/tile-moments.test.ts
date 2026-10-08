import { describe, expect, it } from 'vitest';
import { nudge, steamWisp, tuktukHop } from './tile-moments';

const steps = Array.from({ length: 101 }, (_, i) => i / 100);

describe('service tile moments', () => {
  it('every moment starts and ends at rest', () => {
    for (const end of [1, -1]) {
      expect(nudge(0, end, 10)).toBeCloseTo(0);
      expect(nudge(1, end, 10)).toBeCloseTo(0);
    }
    expect(tuktukHop(0)).toEqual({ y: -0, rotate: 0 });
    expect(tuktukHop(1).y).toBeCloseTo(0);
    expect(tuktukHop(1).rotate).toBeCloseTo(0);
    expect(steamWisp(0, 0)).toEqual({ opacity: 0, y: 0 });
    expect(steamWisp(1, 2)).toEqual({ opacity: 0, y: 0 });
  });

  it('a car pulls forward the way it faces, never past the distance, and settles', () => {
    // RTL: the start side is to the right, so a car facing it pulls with dir +1.
    expect(nudge(0.5, 1, 12)).toBeCloseTo(12);
    expect(nudge(0.5, -1, 12)).toBeCloseTo(-12);
    for (const a of steps) expect(Math.abs(nudge(a, 1, 12))).toBeLessThanOrEqual(12);
  });

  it('the tuktuk only hops upwards, and the steam only rises', () => {
    for (const a of steps) {
      expect(tuktukHop(a).y).toBeLessThanOrEqual(0);
      for (const i of [0, 1, 2]) {
        const w = steamWisp(a, i);
        expect(w.y).toBeLessThanOrEqual(0);
        expect(w.opacity).toBeGreaterThanOrEqual(0);
        expect(w.opacity).toBeLessThanOrEqual(0.85);
      }
    }
  });
});
