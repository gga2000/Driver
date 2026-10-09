import { describe, expect, it } from 'vitest';
import { goldenMapUrls, zoneBounds, zoneFeatures } from './golden-zones';

const sq = (lng: number, lat: number) => [
  { lat, lng },
  { lat, lng: lng + 0.01 },
  { lat: lat + 0.01, lng: lng + 0.01 },
  { lat: lat + 0.01, lng },
];

describe('the zone map on the Golden hour street map', () => {
  it('needs both map addresses from the build', () => {
    expect(goldenMapUrls({})).toBeNull();
    expect(goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: 'https://x/wasit.pmtiles', EXPO_PUBLIC_MAP_GLYPHS_URL: ' ' })).toBeNull();
    expect(goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: 'https://x/wasit.pmtiles', EXPO_PUBLIC_MAP_GLYPHS_URL: 'https://x/fonts/{fontstack}/{range}.pbf' })).toEqual({ tilesUrl: 'https://x/wasit.pmtiles', glyphsUrl: 'https://x/fonts/{fontstack}/{range}.pbf' });
  });

  it('draws closed zone outlines, a dot for a zone with no outline, the selected zone last and the kitchen on top', () => {
    const zones = [
      { key: 'a', ring: sq(45.06, 32.9), centre: { lat: 32.905, lng: 45.065 } },
      { key: 'b', ring: [], centre: { lat: 32.92, lng: 45.08 } },
      { key: 'c', ring: sq(45.07, 32.9), centre: { lat: 32.905, lng: 45.075 } },
    ];
    const out = zoneFeatures(zones, (z) => ({ fill: z.key === 'b' ? '#ccc' : '#f80', dashed: z.key === 'b' }), 'a', { lat: 32.9, lng: 45.07 });
    expect(out.features.map((f) => [f.properties.key, f.properties.kind, f.properties.selected])).toEqual([
      ['b', 'dot', false],
      ['c', 'zone', false],
      ['a', 'zone', true],
      ['kitchen', 'kitchen', false],
    ]);
    const ring = (out.features[2]!.geometry as { coordinates: [number, number][][] }).coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(out.features[0]!.properties).toMatchObject({ fill: '#ccc', dashed: true });
  });

  it('frames every zone and the kitchen', () => {
    expect(zoneBounds([], null)).toBeNull();
    expect(zoneBounds([{ key: 'a', ring: sq(45.06, 32.9), centre: { lat: 0, lng: 0 } }, { key: 'b', ring: [], centre: { lat: 32.95, lng: 45.1 } }], { lat: 32.89, lng: 45.05 })).toEqual([45.05, 32.89, 45.1, 32.95]);
  });
});
