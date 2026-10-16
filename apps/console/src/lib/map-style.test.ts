import { buildMapStyle, LAYER, SOURCE } from '@driver/map';
import { GOLDEN_FIRST_LABEL, GOLDEN_SOURCE } from '@driver/map/golden';
import { describe, expect, it } from 'vitest';
import { consoleMapStyle } from './map-style';

const FILES = { tilesUrl: 'https://x.supabase.co/storage/v1/object/public/map/wasit.pmtiles', glyphsUrl: 'https://x.supabase.co/storage/v1/object/public/map/fonts/{fontstack}/{range}.pbf' };
const ids = (s: { layers: Array<{ id: string }> }) => s.layers.map((l) => l.id);

describe('Console maps on the Golden hour basemap, original map as fallback (Ali 2026-10-09)', () => {
  it('opens the original map, unchanged, while our map files are not set up', () => {
    expect(consoleMapStyle({ theme: 'dark', zoneShading: 'sequential' })).toEqual({ style: buildMapStyle({ theme: 'dark', zoneShading: 'sequential' }), golden: false });
    expect(consoleMapStyle({ theme: 'light', tilesUrl: FILES.tilesUrl }).golden).toBe(false);
  });

  it('goes straight to the original map once ours has failed in this tab', () => {
    expect(consoleMapStyle({ theme: 'light', ...FILES, originalOnly: true })).toEqual({ style: buildMapStyle({ theme: 'light' }), golden: false });
  });

  it('keeps every Console source and layer id, drawn under the street names, with no OSM picture underneath', () => {
    const { style, golden } = consoleMapStyle({ theme: 'light', zoneShading: 'sequential', ...FILES });
    expect(golden).toBe(true);
    expect(style.sources[GOLDEN_SOURCE]).toMatchObject({ type: 'vector', url: `pmtiles://${FILES.tilesUrl}` });
    for (const id of [SOURCE.zones, SOURCE.garages, SOURCE.trips, SOURCE.stops, SOURCE.drivers]) expect(style.sources[id]).toBeDefined();
    expect(style.sources[SOURCE.osm]).toBeUndefined();
    const order = ids(style);
    expect(order).not.toContain(LAYER.osm);
    expect(order).not.toContain(LAYER.background);
    for (const id of [LAYER.zoneFill, LAYER.zoneLine, LAYER.garages, LAYER.tripLines, LAYER.tripStops, LAYER.drivers, LAYER.driverHalo]) {
      expect(order.indexOf(id)).toBeGreaterThan(0);
      expect(order.indexOf(id)).toBeLessThan(order.indexOf(GOLDEN_FIRST_LABEL));
    }
    expect(new Set(order).size).toBe(order.length);
  });

  it('follows the screen’s theme, never the clock: day in light, warm night in dark, flat Console drawing', () => {
    expect(consoleMapStyle({ theme: 'light', ...FILES }).style.metadata).toMatchObject({ 'driver:light': 'day', 'driver:mode': 'console' });
    expect(consoleMapStyle({ theme: 'dark', ...FILES }).style.metadata).toMatchObject({ 'driver:light': 'night', 'driver:mode': 'console' });
  });
});
