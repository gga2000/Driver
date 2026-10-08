import { describe, expect, it } from 'vitest';
import { VEHICLE_MODELS } from '@driver/contracts';
import { CAR_ART_LAYOUTS, pickCarArt } from './car-art-layouts';

const SEATS = { 4: ['front', 'back_left', 'back_middle', 'back_right'], 6: ['front', 'middle_left', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'], 7: ['front', 'middle_left', 'middle_middle', 'middle_right', 'rear_left', 'rear_middle', 'rear_right'] } as const;

describe('car pictures under the seats', () => {
  it('every picture places every seat of its layout inside the picture, on a model that can carry it', () => {
    for (const [key, art] of Object.entries(CAR_ART_LAYOUTS)) {
      const model = VEHICLE_MODELS.find((m) => m.key === key);
      expect(model?.layouts).toContain(art!.layout);
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

  it('draws the run\'s own car only when it has a model, a picture and the same layout', () => {
    const src = { elantra: 'elantra.webp' };
    expect(pickCarArt({ modelKey: 'elantra', layout: 4 }, src)?.source).toBe('elantra.webp');
    expect(pickCarArt({ modelKey: null, layout: 4 }, src)).toBeNull();
    expect(pickCarArt({ modelKey: 'corolla', layout: 4 }, src)).toBeNull();
    expect(pickCarArt({ modelKey: 'elantra', layout: 7 }, src)).toBeNull();
    expect(pickCarArt(null, src)).toBeNull();
  });
});
