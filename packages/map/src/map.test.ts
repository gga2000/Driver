import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { TIER_COLORS, TIER_RAMP, TIERS_IN_ORDER } from './colors.js';
import { buildGaragesGeoJSON, GARAGES } from './garages.js';
import { distanceM, regularPolygon, ringArea } from './geo.js';
import { buildMapStyle, LAYER, SOURCE } from './style.js';
import { AZIZIYAH_BOUNDS, buildZoneCentroidsGeoJSON, buildZonesGeoJSON, zonesBounds } from './zones.js';

describe('regularPolygon', () => {
  it('builds a closed counter-clockwise hexagon whose vertices sit on the radius', () => {
    const ring = regularPolygon(32.905, 45.06, 450);
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    expect(ringArea(ring)).toBeGreaterThan(0);
    for (const [lng, lat] of ring) {
      expect(distanceM({ lat: 32.905, lng: 45.06 }, { lat, lng })).toBeGreaterThan(440);
      expect(distanceM({ lat: 32.905, lng: 45.06 }, { lat, lng })).toBeLessThan(460);
    }
  });
  it('rejects nonsense', () => {
    expect(() => regularPolygon(0, 0, 100, 2)).toThrow();
    expect(() => regularPolygon(0, 0, 0)).toThrow();
  });
});

describe('zones GeoJSON', () => {
  const fc = buildZonesGeoJSON();
  it('has all 34 seed zones, one hexagon each', () => {
    expect(fc.features).toHaveLength(34);
    expect(new Set(fc.features.map((f) => f.properties.id)).size).toBe(34);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('Polygon');
      expect(f.geometry.coordinates[0]).toHaveLength(7);
    }
  });
  it('shades each zone by its tier', () => {
    const khamas = fc.features.find((f) => f.properties.id === 'khamas')!;
    expect(khamas.properties.tier).toBe('far');
    expect(khamas.properties.color).toBe(TIER_COLORS.far);
    const centre = fc.features.find((f) => f.properties.id === 'centre')!;
    expect(centre.properties.color).toBe(TIER_COLORS.centre);
    expect(centre.properties.name_ar).toBe('العزيزية (مركز)');
  });
  it('uses numeric feature ids for feature-state', () => {
    expect(fc.features.map((f) => f.id)).toEqual(AZIZIYAH_ZONES.map((_, i) => i));
  });
  it('centroids match the seed', () => {
    const pts = buildZoneCentroidsGeoJSON();
    expect(pts.features[0]!.geometry.coordinates).toEqual([AZIZIYAH_ZONES[0]!.lng, AZIZIYAH_ZONES[0]!.lat]);
  });
});

describe('bounds', () => {
  it('contains every zone centroid and the town garages', () => {
    const [[w, s], [e, n]] = AZIZIYAH_BOUNDS;
    for (const z of AZIZIYAH_ZONES) {
      expect(z.lng).toBeGreaterThan(w);
      expect(z.lng).toBeLessThan(e);
      expect(z.lat).toBeGreaterThan(s);
      expect(z.lat).toBeLessThan(n);
    }
    for (const g of GARAGES.filter((x) => x.inCity)) {
      expect(g.lng).toBeGreaterThan(w);
      expect(g.lat).toBeLessThan(n);
    }
  });
  it('grows with the margin', () => {
    const [[w0]] = zonesBounds(AZIZIYAH_ZONES, 0);
    const [[w1]] = zonesBounds(AZIZIYAH_ZONES, 1000);
    expect(w1).toBeLessThan(w0);
  });
});

describe('garages', () => {
  it('lists the four garages; the town map drops Baghdad', () => {
    expect(GARAGES.map((g) => g.name_ar)).toEqual(['كراج البوابة 1', 'كراج البوابة 2', 'كراج السوق', 'كراج النهضة']);
    expect(buildGaragesGeoJSON().features).toHaveLength(4);
    expect(buildGaragesGeoJSON({ onlyInCity: true }).features).toHaveLength(3);
  });
});

describe('style', () => {
  it('is a valid MapLibre style with the raster fallback', () => {
    const style = buildMapStyle();
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources[SOURCE.osm]?.type).toBe('raster');
    expect(style.sources[SOURCE.basemap]).toBeUndefined();
    expect(style.glyphs).toBeUndefined();
    const ids = style.layers.map((l) => l.id);
    expect(ids).toContain(LAYER.zoneFill);
    expect(ids.indexOf(LAYER.drivers)).toBeGreaterThan(ids.indexOf(LAYER.zoneFill));
  });
  it('switches to the PMTiles vector base with Arabic-first labels when a URL is given', () => {
    const style = buildMapStyle({ pmtilesUrl: 'pmtiles://example.test/aziziyah.pmtiles' });
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources[SOURCE.basemap]?.type).toBe('vector');
    expect(style.glyphs).toBeTruthy();
    const labels = style.layers.find((l) => l.id === 'place-labels');
    expect(JSON.stringify(labels)).toContain('name:ar');
  });
});

describe('light theme (customer app)', () => {
  it('is a valid style with the cream base, a light raster and faint zones; dark stays the default', () => {
    const light = buildMapStyle({ theme: 'light' });
    expect(validateStyleMin(light)).toEqual([]);
    expect(light.name).toBe('Driver light');
    const bg = light.layers.find((l) => l.id === LAYER.background) as { paint: Record<string, unknown> };
    expect(bg.paint['background-color']).toBe('#efe7da');
    const raster = light.layers.find((l) => l.id === LAYER.osm) as { paint: Record<string, unknown> };
    expect(raster.paint['raster-hue-rotate']).toBeUndefined();
    const zones = light.layers.find((l) => l.id === LAYER.zoneFill) as { paint: Record<string, unknown> };
    expect(zones.paint['fill-opacity']).toBe(0.1);
    expect(buildMapStyle().name).toBe('Driver dark');
  });
});

describe('sequential tier bands (Console, K-09)', () => {
  it('shades tiers with one ramp that darkens outwards on light and lightens outwards on dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      const style = buildMapStyle({ theme, zoneShading: 'sequential' });
      expect(validateStyleMin(style)).toEqual([]);
      const fill = style.layers.find((l) => l.id === LAYER.zoneFill) as { paint: Record<string, unknown> };
      expect(JSON.stringify(fill.paint['fill-color'])).toContain(TIER_RAMP[theme].edge);
      const lum = TIERS_IN_ORDER.map((tier) => parseInt(TIER_RAMP[theme][tier].slice(1, 3), 16));
      const sorted = [...lum].sort((a, b) => (theme === 'light' ? b - a : a - b));
      expect(lum).toEqual(sorted);
    }
    // The defaults are untouched: the customer app keeps its wash, the dark map its categorical tiers.
    const wash = buildMapStyle({ theme: 'light' }).layers.find((l) => l.id === LAYER.zoneFill) as { paint: Record<string, unknown> };
    expect(wash.paint['fill-opacity']).toBe(0.1);
  });
});

describe('zone labels', () => {
  it('show Western digits on the map (the seed keeps "شارع ٣٠")', () => {
    const labels = [...buildZonesGeoJSON().features, ...buildZoneCentroidsGeoJSON().features].map((f) => f.properties.name_ar);
    expect(labels.some((l) => /[٠-٩۰-۹]/.test(l))).toBe(false);
    expect(labels).toContain('شارع 30');
  });
});
