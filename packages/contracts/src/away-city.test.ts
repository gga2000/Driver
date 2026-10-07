import { describe, expect, it } from 'vitest';
import { awayCityAt, type AwayCityGarage } from './away-city.js';

/** The network's garages (apps/api routes intercity.config). */
const GARAGES: AwayCityGarage[] = [
  { cityId: 'aziziyah', lat: 32.9032, lng: 45.0578 },
  { cityId: 'aziziyah', lat: 32.9088, lng: 45.0648 },
  { cityId: 'aziziyah', lat: 32.9062, lng: 45.0612 },
  { cityId: 'baghdad', lat: 33.3344, lng: 44.4165 },
  { cityId: 'kut', lat: 32.5126, lng: 45.8189 },
];

describe('awayCityAt (ride idea n9)', () => {
  it('finds Baghdad across the city, not only at the garage', () => {
    expect(awayCityAt({ lat: 33.3344, lng: 44.4165 }, GARAGES)).toBe('baghdad');
    // الكاظمية, المنصور, مدينة الصدر
    expect(awayCityAt({ lat: 33.38, lng: 44.34 }, GARAGES)).toBe('baghdad');
    expect(awayCityAt({ lat: 33.31, lng: 44.35 }, GARAGES)).toBe('baghdad');
    expect(awayCityAt({ lat: 33.39, lng: 44.46 }, GARAGES)).toBe('baghdad');
  });

  it('finds Kut', () => {
    expect(awayCityAt({ lat: 32.51, lng: 45.83 }, GARAGES)).toBe('kut');
  });

  it('is null at home, on the road home and without a position', () => {
    expect(awayCityAt({ lat: 32.9062, lng: 45.0612 }, GARAGES)).toBeNull();
    // سلمان باك, half-way home from Baghdad
    expect(awayCityAt({ lat: 33.0985, lng: 44.58 }, GARAGES)).toBeNull();
    expect(awayCityAt({ lat: 32.75, lng: 45.35 }, GARAGES)).toBeNull();
    expect(awayCityAt(null, GARAGES)).toBeNull();
    expect(awayCityAt({ lat: 33.3344, lng: 44.4165 }, [])).toBeNull();
  });

  it('ignores a city with no radius and takes the radius it is given', () => {
    expect(awayCityAt({ lat: 33.3344, lng: 44.4165 }, GARAGES, { kut: 10 })).toBeNull();
    expect(awayCityAt({ lat: 33.1, lng: 44.6 }, GARAGES, { baghdad: 40 })).toBe('baghdad');
  });
});
