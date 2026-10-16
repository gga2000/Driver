import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAR_ART_LAYOUTS as CUSTOMER_LAYOUTS } from '../../../../customer/src/features/rajaa/car-art-layouts';
import { CAR_ART_LAYOUTS, pickCarArt } from './car-art-layouts';

const asset = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));

describe("his own car on the garage page", () => {
  it('places every seat exactly where the rider sees it, on the same picture', () => {
    expect(CAR_ART_LAYOUTS).toEqual(CUSTOMER_LAYOUTS);
    for (const key of Object.keys(CAR_ART_LAYOUTS)) {
      expect(asset(`../../../assets/cars/${key}.webp`).equals(asset(`../../../../customer/assets/cars/${key}.webp`)), key).toBe(true);
    }
  });

  it("draws the run's own car only when it has a model, a picture and the same layout", () => {
    const src = { elantra: 'elantra.webp' };
    expect(pickCarArt({ modelKey: 'elantra', layout: 4 }, src)?.source).toBe('elantra.webp');
    expect(pickCarArt({ modelKey: null, layout: 4 }, src)).toBeNull();
    expect(pickCarArt({ modelKey: 'corolla', layout: 4 }, src)).toBeNull();
    expect(pickCarArt({ modelKey: 'elantra', layout: 7 }, src)).toBeNull();
    expect(pickCarArt(null, src)).toBeNull();
  });
});
