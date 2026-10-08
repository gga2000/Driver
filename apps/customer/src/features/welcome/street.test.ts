import { describe, expect, it } from 'vitest';
import { shadeStops, STREET_ASPECT, STREET_FLOOR, streetLift } from './street';

/** Where the road line lands on screen for a lift (mirrors the cover fit in `streetLift`). */
const floor = (w: number, h: number, lift: number) => {
  const box = h + lift;
  const photoH = Math.max(box, w / STREET_ASPECT);
  return (box - photoH) / 2 + photoH * STREET_FLOOR - lift;
};

describe('golden-street photo fit', () => {
  it('a tall phone whose words start under the road keeps the photo as it is', () => {
    expect(streetLift(390, 844, 560)).toBe(0);
  });

  it('a short phone lifts the photo until the road clears the headline', () => {
    const lift = streetLift(360, 640, 340);
    expect(lift).toBeGreaterThan(0);
    expect(floor(360, 640, lift)).toBeLessThanOrEqual(340 - 12 + 1);
  });

  it('never lifts past 40 % of the screen, and does nothing before the words are measured', () => {
    expect(streetLift(360, 640, 40)).toBe(Math.round(640 * 0.4));
    expect(streetLift(360, 640, 0)).toBe(0);
  });

  it('the shade is clear above the words and full under them, stops in order', () => {
    const stops = shadeStops(844, 520);
    const offsets = stops.map(([o]) => o);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(stops[2]![1]).toBe(0);
    expect(stops[4]![1]).toBe(1);
    expect(stops[3]![0]).toBeCloseTo(536 / 844, 3);
  });
});
