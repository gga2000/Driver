import { describe, expect, it } from 'vitest';
import { AZIZIYAH_LANDMARKS, PLACE_LANDMARK_CHOICES, type LandmarkView, type LatLng, type Place } from '@driver/contracts';
import { cityLandmarks, nearestLandmarks } from './landmarks.js';

const PIN: LatLng = { lat: 32.9095, lng: 45.0635 };
/** About `m` metres north of PIN (1° of latitude ≈ 111.2 km). */
const north = (m: number): LatLng => ({ lat: PIN.lat + m / 111_195, lng: PIN.lng });
const lm = (id: string, pin: LatLng): LandmarkView => ({ id, name_ar: id, name_en: id, pin, zoneId: 'street_30', kind: 'landmark', aliases_ar: [], photoUrl: null });
const place = (id: string, name: string, pin: LatLng): Place => ({ id, cityId: 'aziziyah', pin, name, photos: [], confidence: 0.9, sharedWith: [], landmark: true });

describe('nearestLandmarks — the "قرب شنو؟" chips (maps program a2)', () => {
  it('only within 500 m, nearest first, with whole metres', () => {
    const near = nearestLandmarks([lm('far', north(520)), lm('mid', north(300)), lm('edge', north(499)), lm('close', north(40))], PIN);
    expect(near.map((l) => [l.id, l.distanceM])).toEqual([
      ['close', 40],
      ['mid', 300],
      ['edge', 499],
    ]);
  });

  it(`at most ${PLACE_LANDMARK_CHOICES}, the nearest ones; equal distances keep a stable order`, () => {
    const all = [70, 10, 60, 20, 50, 30, 40].map((m) => lm(`m${m}`, north(m)));
    expect(nearestLandmarks(all, PIN).map((l) => l.id)).toEqual(['m10', 'm20', 'm30', 'm40', 'm50']);
    expect(nearestLandmarks([lm('b', north(80)), lm('a', north(80))], PIN).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('nothing near: an empty list (the editor hides the step)', () => {
    expect(nearestLandmarks([lm('far', north(2000))], PIN)).toEqual([]);
    expect(nearestLandmarks([], PIN)).toEqual([]);
  });
});

describe('cityLandmarks — one list for search, chips, places and couriers', () => {
  const zoneOf = (p: LatLng) => (p.lat > 33 ? null : 'street_30');

  it('the seed first, ids lm_<key>, names with Western digits', () => {
    const all = cityLandmarks('aziziyah', [], zoneOf);
    expect(all.map((l) => l.id)).toEqual(AZIZIYAH_LANDMARKS.map((l) => `lm_${l.key}`));
    expect(all.find((l) => l.id === 'lm_garage_bab1')?.name_ar).toBe('كراج البوابة 1');
    expect(all.every((l) => !/[٠-٩]/.test(l.name_ar))).toBe(true);
  });

  it('approved places join unless out of service or already in the seed by name', () => {
    const learned = [place('pl_bakery', 'فرن أبو علي', north(100)), place('pl_far', 'بغداد', { lat: 33.3, lng: 44.4 }), place('pl_dup', 'تقاطع شارع ٣٠', north(10))];
    const all = cityLandmarks('aziziyah', learned, zoneOf);
    expect(all.filter((l) => l.kind === 'landmark').map((l) => l.id)).toEqual(['pl_bakery']);
    // Another city has no seed: its approved places only.
    expect(cityLandmarks('kut', [place('pl_k', 'جامع', PIN)], zoneOf).map((l) => l.id)).toEqual(['pl_k']);
  });
});
