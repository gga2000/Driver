import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  GARAGE_BAYS,
  demandGlowGeoJSON,
  demandGlowLayers,
  garageSeatLayers,
  garageSeatsGeoJSON,
  khatRouteGeoJSON,
  khatRouteLayers,
  roadsFromFeatures,
  safeStopFor,
  shopWarmGeoJSON,
  shopWarmLayers,
  slowStretchGeoJSON,
  slowStretchLayers,
  sunriseTour,
  walkColours,
  walkToStopGeoJSON,
  walkToStopLayers,
  type Road,
} from './index.js';
import { metresBetween, offsetMetres } from './metres.js';

const PIN: [number, number] = [45.06, 32.906];
// a main road 80 m north of the pin, running east–west, and a lane up to it
const MAIN: Road = { cls: 'major', coords: [offsetMetres(PIN, -300, 80), offsetMetres(PIN, 300, 80)] };
const LANE: Road = { cls: 'minor', coords: [PIN, offsetMetres(PIN, 0, 80)] };

/** The layers in a throwaway style, checked by MapLibre's own validator. */
function valid(layers: LayerSpecification[], sources: string[]) {
  const style: StyleSpecification = {
    version: 8,
    glyphs: 'https://example.com/{fontstack}/{range}.pbf',
    sources: Object.fromEntries(sources.map((s) => [s, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true }])),
    layers,
  };
  return validateStyleMin(style);
}

const hexes = (x: unknown) => JSON.stringify(x).match(/#[0-9A-Fa-f]{6}/g) ?? [];
/** No blue or teal (brand rule): no hue between 160° and 260° with real saturation. */
function noBlue(x: unknown) {
  for (const h of hexes(x)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.08) continue;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    expect(hue < 160 || hue > 260, `${h} is blue or teal`).toBe(true);
  }
}

describe('walk to a safe stop (N10)', () => {
  it('reads streets from map features', () => {
    const roads = roadsFromFeatures([
      { properties: { cls: 'major' }, geometry: { type: 'LineString', coordinates: MAIN.coords } },
      { properties: { cls: 'minor' }, geometry: { type: 'MultiLineString', coordinates: [LANE.coords, LANE.coords] } },
      { properties: {}, geometry: { type: 'Point', coordinates: PIN } },
    ]);
    expect(roads.map((r) => r.cls)).toEqual(['major', 'minor', 'minor']);
  });
  it('offers the main road from an alley, by a landmark when it is barely further', () => {
    const plain = safeStopFor(PIN, [MAIN, LANE], []);
    expect(plain?.landmarkName).toBeNull();
    expect(plain?.walkM).toBeGreaterThan(75);
    expect(plain?.walkM).toBeLessThan(85);
    const mosque = { name: 'الجامع الكبير', at: offsetMetres(PIN, 30, 100) };
    const by = safeStopFor(PIN, [MAIN, LANE], [mosque]);
    expect(by?.landmarkName).toBe('الجامع الكبير');
    expect(metresBetween(by!.stop, offsetMetres(PIN, 30, 80))).toBeLessThan(2);
    // a landmark that makes the walk much longer is not worth it
    const far = safeStopFor(PIN, [MAIN, LANE], [{ name: 'بعيد', at: offsetMetres(PIN, 200, 100) }]);
    expect(far?.landmarkName).toBeNull();
  });
  it('offers nothing by a main road, or when the main road is too far', () => {
    expect(safeStopFor(offsetMetres(PIN, 0, 70), [MAIN], [])).toBeNull();
    expect(safeStopFor(PIN, [MAIN], [], { maxWalkM: 50 })).toBeNull();
    expect(safeStopFor(PIN, [LANE], [])).toBeNull();
  });
  it('draws the walk once from the pin, the stop always there', () => {
    const to = offsetMetres(PIN, 0, 80);
    expect(walkToStopGeoJSON(PIN, to, 0).features.map((f) => f.properties.part)).toEqual(['stop']);
    const half = walkToStopGeoJSON(PIN, to, 0.5).features[0]!;
    expect(metresBetween(PIN, (half.geometry.coordinates as [number, number][])[1]!)).toBeCloseTo(40, 0);
    expect(walkToStopGeoJSON(PIN, to).features).toHaveLength(2);
    for (const light of ['day', 'night'] as const) {
      expect(valid(walkToStopLayers({ source: 'w', light }), ['w'])).toEqual([]);
      noBlue(walkColours(light));
    }
  });
});

describe('why it is late (N6) and the shop warming (N16)', () => {
  const path: [number, number][] = [PIN, offsetMetres(PIN, 0, 500), offsetMetres(PIN, 500, 500)];
  it('cuts the slow stretch out of the route with a label in the middle', () => {
    const fc = slowStretchGeoJSON(path, 300, 700, 'زحمة السوق · 6 دقايق');
    const line = fc.features[0]!.geometry.coordinates as [number, number][];
    expect(metresBetween(line[0]!, offsetMetres(PIN, 0, 300))).toBeLessThan(1);
    expect(metresBetween(line.at(-1)!, offsetMetres(PIN, 200, 500))).toBeLessThan(1);
    expect(metresBetween(fc.features[1]!.geometry.coordinates as [number, number], offsetMetres(PIN, 0, 500))).toBeLessThan(1);
    expect(slowStretchGeoJSON(path, 1100, 1200, 'x').features).toEqual([]);
  });
  it('makes valid layers in every light, never blue', () => {
    for (const light of ['day', 'golden', 'night'] as const) {
      const layers = [...slowStretchLayers({ source: 's', light }), ...shopWarmLayers({ source: 'w', light })];
      expect(valid(layers, ['s', 'w'])).toEqual([]);
      noBlue(layers);
    }
    expect(shopWarmGeoJSON(PIN).features[0]!.geometry.type).toBe('Polygon');
  });
});

describe('seats over the cars at the garage (N12)', () => {
  it('knows where the cars stand in each garage, close to the garage itself', () => {
    const near: Record<string, [number, number]> = { bab1: [45.04035, 32.9159], bab2: [45.06407, 32.91543], souq: [45.06648, 32.90227] };
    for (const [k, bays] of Object.entries(GARAGE_BAYS)) {
      expect(bays.length).toBeGreaterThan(20);
      for (const b of bays) expect(metresBetween(b.at, near[k]!)).toBeLessThan(45);
    }
  });
  it('floats one block per seat over the car, the taken ones first', () => {
    const bay = GARAGE_BAYS.bab1[0]!;
    const fc = garageSeatsGeoJSON([{ id: 'dep_1', at: bay.at, bearing: bay.bearing, seats: 7, taken: 5 }]);
    expect(fc.features).toHaveLength(7);
    expect(fc.features.map((f) => f.properties.free)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(new Set(fc.features.map((f) => f.properties.car))).toEqual(new Set(['dep_1']));
    for (const f of fc.features) expect(metresBetween((f.geometry.coordinates[0] as [number, number][])[0]!, bay.at)).toBeLessThan(5);
    for (const light of ['day', 'night'] as const) {
      expect(valid(garageSeatLayers({ source: 'g', light }), ['g'])).toEqual([]);
      noBlue(garageSeatLayers({ source: 'g', light }));
    }
  });
});

describe('خطوط route: only your home and the bus (N14)', () => {
  it('puts other stops on the line from fractions, never from addresses', () => {
    const route: [number, number][] = [PIN, offsetMetres(PIN, 1000, 0)];
    const fc = khatRouteGeoJSON({ route, school: route[1]!, mine: route[0]!, others: [0.25, 0.5, 2, 0] });
    const others = fc.features.filter((f) => (f as { properties: { part: string } }).properties.part === 'other') as { geometry: { coordinates: [number, number] } }[];
    expect(others).toHaveLength(2);
    expect(metresBetween(others[0]!.geometry.coordinates, offsetMetres(PIN, 250, 0))).toBeLessThan(1);
    expect(JSON.stringify(fc)).not.toContain('name');
    for (const light of ['day', 'night'] as const) expect(valid(khatRouteLayers({ source: 'k', light }), ['k'])).toEqual([]);
  });
});

describe('where the orders are (N17)', () => {
  it('lights only busy cells, amber and never blue', () => {
    const fc = demandGlowGeoJSON([{ at: PIN, weight: 0.9 }, { at: PIN, weight: 0.05 }, { at: PIN, weight: 3 }]);
    expect(fc.features.map((f) => f.properties.w)).toEqual([0.9, 1]);
    for (const light of ['day', 'night'] as const) {
      expect(valid(demandGlowLayers({ source: 'd', light }), ['d'])).toEqual([]);
      noBlue(demandGlowLayers({ source: 'd', light }));
    }
  });
});

describe('sunrise over Aziziyah (N4)', () => {
  it('plays about 8 s once and ends on the day map over the town', () => {
    const t = sunriseTour();
    expect(t.totalMs).toBe(8000);
    expect(t.keyframes.at(-1)!.atMs).toBe(t.totalMs);
    expect(t.lights.at(-1)!.light).toBe('day');
    expect(t.keyframes.map((k) => k.atMs)).toEqual([...t.keyframes.map((k) => k.atMs)].sort((a, b) => a - b));
    expect(metresBetween(t.keyframes.at(-1)!.center, [45.06, 32.906])).toBeLessThan(1);
  });
});
