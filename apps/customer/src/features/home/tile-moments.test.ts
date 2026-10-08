import { describe, expect, it } from 'vitest';
import { nudge, starsX, steamWisp, taxiX, tuktukHop } from './tile-moments';

const steps = Array.from({ length: 101 }, (_, i) => i / 100);

describe('service tile moments', () => {
  it('every moment starts and ends at rest', () => {
    for (const end of [1, -1]) {
      expect(taxiX(0, end)).toBe(0);
      expect(taxiX(1, end)).toBe(0);
      expect(nudge(0, end, 10)).toBeCloseTo(0);
      expect(nudge(1, end, 10)).toBeCloseTo(0);
    }
    expect(tuktukHop(0)).toEqual({ y: -0, rotate: 0 });
    expect(tuktukHop(1).y).toBeCloseTo(0);
    expect(tuktukHop(1).rotate).toBeCloseTo(0);
    expect(steamWisp(0, 0)).toEqual({ opacity: 0, y: 0 });
    expect(steamWisp(1, 2)).toEqual({ opacity: 0, y: 0 });
  });

  it('the taxi drives off toward the reading end, then comes back in from the other side', () => {
    // RTL: the end is to the left.
    expect(taxiX(0.3, -1)).toBeLessThan(-20);
    expect(taxiX(0.5, -1)).toBeGreaterThan(20);
    expect(Math.max(...steps.map((a) => Math.abs(taxiX(a, -1))))).toBeLessThanOrEqual(84);
  });

  it('the star lines move exactly one tile, so the pattern lands where it started', () => {
    expect(starsX(0, -1, 34)).toBeCloseTo(0);
    expect(starsX(1, -1, 34)).toBeCloseTo(34);
    expect(starsX(1, 1, 34)).toBeCloseTo(-34);
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
