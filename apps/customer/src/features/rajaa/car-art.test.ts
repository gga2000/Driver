import { describe, expect, it } from 'vitest';
import { CAR_ART_LAYOUTS, pickCarArt } from './car-art-layouts';

const SEATS = { 4: ['front', 'back_left', 'back_middle', 'back_right'], 6: ['front', 'middle_left', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'], 7: ['front', 'middle_left', 'middle_middle', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'] } as const;

describe('the flat car under the seats', () => {
  it('every picture places every seat of its layout inside the picture', () => {
    for (const [key, art] of Object.entries(CAR_ART_LAYOUTS)) {
      expect(String(art!.layout)).toBe(key);
      for (const id of SEATS[art!.layout]) {
        const p = art!.seats[id];
        expect(p, `${key} ${id}`).toBeTruthy();
        expect(p!.x).toBeGreaterThan(0);
        expect(p!.x).toBeLessThan(100);
        expect(p!.y).toBeGreaterThan(0);
        expect(p!.y).toBeLessThan(100);
      }
    }
  });

  it('draws the flat car for every 4-seat car, whatever its model, and the plain map otherwise', () => {
    const src = { 4: 'sedan.webp' };
    expect(pickCarArt({ layout: 4 }, src)?.source).toBe('sedan.webp');
    expect(pickCarArt({ layout: 7 }, src)).toBeNull();
    expect(pickCarArt(null, src)).toBeNull();
  });
});
