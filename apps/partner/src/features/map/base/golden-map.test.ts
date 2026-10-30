import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, SOURCE } from '@driver/map';
import { GOLDEN_FIRST_LABEL, GOLDEN_SOURCE } from '@driver/map/golden';
import { courierGoldenStyle, goldenLightFor } from './golden-map';

const ORIGINAL = buildMapStyle({ theme: 'light' }) as unknown as StyleSpecification;
const URLS = { tilesUrl: 'https://x.test/map/wasit.pmtiles', glyphsUrl: 'https://x.test/map/fonts/{fontstack}/{range}.pbf' };

describe('Golden hour map on the courier web map', () => {
  it('stays on the original map until both URLs are set', () => {
    expect(courierGoldenStyle({}, 'day', ORIGINAL)).toBeNull();
    expect(courierGoldenStyle({ tilesUrl: URLS.tilesUrl }, 'day', ORIGINAL)).toBeNull();
    expect(courierGoldenStyle({ glyphsUrl: URLS.glyphsUrl }, 'day', ORIGINAL)).toBeNull();
  });

  it('draws our tiles in courier mode with the zones under the street names', () => {
    const s = courierGoldenStyle(URLS, 'golden', ORIGINAL)!;
    expect(s.sources[GOLDEN_SOURCE]).toMatchObject({ type: 'vector', url: `pmtiles://${URLS.tilesUrl}` });
    expect(s.sources[SOURCE.zones]).toBe(ORIGINAL.sources[SOURCE.zones]);
    expect((s.metadata as Record<string, string>)['driver:mode']).toBe('courier');
    const ids = s.layers.map((l) => l.id);
    const zones = ids.filter((id) => id.startsWith('zones-'));
    expect(zones).toEqual(['zones-fill', 'zones-line']);
    for (const z of zones) expect(ids.indexOf(z)).toBeLessThan(ids.indexOf(GOLDEN_FIRST_LABEL));
    // Nothing of the original street picture comes along.
    expect(ids).not.toContain('osm-raster');
  });

  it('follows the app look: night look → night map; day look never shows the night map', () => {
    const midnight = new Date('2026-10-09T21:00:00Z'); // 00:00 in Aziziyah
    const noon = new Date('2026-10-09T09:00:00Z');
    expect(goldenLightFor(true, noon)).toBe('night');
    expect(goldenLightFor(false, midnight)).toBe('day');
    expect(goldenLightFor(false, noon)).toBe('day');
  });
});
