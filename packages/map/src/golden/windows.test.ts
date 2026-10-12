import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { houseWindows, housesFromFeatures, windowLayers, WINDOW_SOURCE } from './windows.js';
import type { GoldenLight } from './sun.js';

// a 12 × 8 m two-storey house at the centre of Aziziyah
const kx = 111320 * Math.cos((32.906 * Math.PI) / 180);
const at = (x: number, y: number): [number, number] => [45.06 + x / kx, 32.906 + y / 110540];
const ring = [at(0, 0), at(12, 0), at(12, 8), at(0, 8), at(0, 0)];

describe('windows', () => {
  it('puts a roof wall on every edge, one door, and a row of windows per storey', () => {
    const fc = houseWindows([{ ring, hm: 6.8, tone: 2, lit: true }]);
    const kinds = fc.features.map((f) => f.properties!.k);
    expect(kinds.filter((k) => k === 'parapet')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'door')).toHaveLength(1);
    // 12 m walls: 3 windows a storey; 8 m walls: 2; two storeys, less the door
    expect(kinds.filter((k) => k === 'win')).toHaveLength((3 + 2 + 3 + 2) * 2 - 1);
    const top = Math.max(...fc.features.map((f) => f.properties!.t as number));
    expect(top).toBeCloseTo(7.4);
  });
  it('faces outward whichever way the outline runs', () => {
    const cw = houseWindows([{ ring: [...ring].reverse(), hm: 3.6 }]);
    const ccw = houseWindows([{ ring, hm: 3.6 }]);
    const lngs = (fc: typeof cw) => fc.features.filter((f) => f.properties!.k === 'win').flatMap((f) => f.geometry.coordinates[0]!.map((c) => c[0]!));
    // windows stand out from the walls: some reach beyond the house's west and east sides, in both cases
    for (const fc of [cw, ccw]) expect(Math.min(...lngs(fc))).toBeLessThan(45.06);
  });
  it('skips tiny sheds and keeps each house once, nearest first', () => {
    expect(houseWindows([{ ring: [at(0, 0), at(2, 0), at(2, 2), at(0, 2), at(0, 0)], hm: 3.6 }]).features).toHaveLength(0);
    const far = ring.map(([x, y]) => [x + 0.01, y] as [number, number]);
    const feats = [
      { geometry: { type: 'Polygon', coordinates: [far] }, properties: { kind: 'house', hm: 3.6 } },
      { geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'house', hm: 6.8, lit: 1 } },
      { geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'house', hm: 6.8, lit: 1 } },
      { geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'mosque', hm: 7.5 } },
    ];
    const houses = housesFromFeatures(feats, [45.06, 32.906], 5);
    expect(houses).toHaveLength(2);
    expect(houses[0]!.hm).toBe(6.8);
    expect(houses[0]!.lit).toBe(true);
    expect(housesFromFeatures(feats, [45.06, 32.906], 1)).toHaveLength(1);
  });
  it('draws valid layers in every light', () => {
    for (const light of ['day', 'morning', 'golden', 'sunset', 'night'] as GoldenLight[]) {
      const style = { version: 8, sources: { [WINDOW_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: windowLayers(light) };
      expect(validateStyleMin(style as never)).toEqual([]);
    }
  });
});
