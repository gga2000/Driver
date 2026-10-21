import { describe, expect, it } from 'vitest';
import type { MapLandmark } from '@driver/contracts';
import { groupMove, landmarkPins, matchesQuery, parseAliases, pinsInBox, restaurantPins } from './map-editor';

const lm = (id: string, lat: number, lng: number, extra: Partial<MapLandmark> = {}): MapLandmark => ({
  id,
  name_ar: id,
  aliases_ar: [],
  category: 'other',
  pin: { lat, lng },
  zoneKey: 'centre',
  seeded: false,
  hidden: false,
  photoUrl: null,
  ...extra,
});

describe('map editor helpers', () => {
  it('draws only restaurants that have a place, and setup landmarks stay put', () => {
    const r = restaurantPins([{ orgId: 'o1', name: 'مطعم خالد', type: 'restaurant', pin: null, zoneKey: null, zoneName: null, pickupNote: null }, { orgId: 'o2', name: 'كص', type: 'restaurant', pin: { lat: 1, lng: 2 }, zoneKey: 'centre', zoneName: 'المركز', pickupNote: null }], true);
    expect(r.map((p) => p.id)).toEqual(['o2']);
    const l = landmarkPins([lm('lm_garage_souq', 1, 1, { seeded: true }), lm('pl_1', 1, 1, { hidden: true })], true);
    expect(l.map((p) => [p.draggable, p.renamable, p.tone])).toEqual([[false, false, 'place'], [true, true, 'hidden']]);
  });

  it('finds a place by any of its names, with or without «ال» and hamza', () => {
    expect(matchesQuery('الجامع', 'باب الجامع الكبير')).toBe(true);
    expect(matchesQuery('اسواق', 'أسواق كريم')).toBe(true);
    expect(matchesQuery('ساعة', 'دوار', 'دوّار الساعه')).toBe(true);
    expect(matchesQuery('', 'x')).toBe(true);
    expect(matchesQuery('فرن', 'كص')).toBe(false);
  });

  it('moves a whole selection by the dragged pin’s step, and a lone pin alone', () => {
    const pins = landmarkPins([lm('a', 32.9, 45.06), lm('b', 32.901, 45.061), lm('c', 32.91, 45.07)], true);
    const sel = new Set(['landmark:a', 'landmark:b']);
    const moves = groupMove(pins, sel, 'landmark:a', { lat: 32.9005, lng: 45.0602 });
    expect(moves.map((m) => m.id)).toEqual(['a', 'b']);
    expect(moves[1]!.pin.lat).toBeCloseTo(32.9015, 6);
    expect(moves[1]!.pin.lng).toBeCloseTo(45.0612, 6);
    expect(groupMove(pins, sel, 'landmark:c', { lat: 32.92, lng: 45.07 }).map((m) => m.id)).toEqual(['c']);
  });

  it('picks the pins inside a dragged box, whichever corner it started from', () => {
    const pins = landmarkPins([lm('a', 32.9, 45.06), lm('b', 32.95, 45.1)], true);
    expect(pinsInBox(pins, { lat: 32.91, lng: 45.07 }, { lat: 32.89, lng: 45.05 })).toEqual(['landmark:a']);
  });

  it('reads other names typed with either comma', () => {
    expect(parseAliases('الساعة، دوار الساعة , الساعة,')).toEqual(['الساعة', 'دوار الساعة']);
  });
});
