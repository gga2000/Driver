import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAR_ART_LAYOUTS as CUSTOMER_LAYOUTS } from '../../../../customer/src/features/rajaa/car-art-layouts';
import { CAR_ART_LAYOUTS, pickCarArt } from './car-art-layouts';

const asset = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));

describe("his own car on the garage page", () => {
  it('places every seat exactly where the rider sees it, on the same picture', () => {
    expect(CAR_ART_LAYOUTS).toEqual(CUSTOMER_LAYOUTS);
    expect(asset('../../../assets/cars/sedan.webp').equals(asset('../../../../customer/assets/cars/sedan.webp'))).toBe(true);
  });

  it('draws the flat car for every 4-seat car and the drawn map otherwise', () => {
    const src = { 4: 'sedan.webp' };
    expect(pickCarArt({ layout: 4 }, src)?.source).toBe('sedan.webp');
    expect(pickCarArt({ layout: 7 }, src)).toBeNull();
    expect(pickCarArt(null, src)).toBeNull();
  });
});
