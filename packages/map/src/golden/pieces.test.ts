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
  myTripWidth,
  myTripsBounds,
  myTripsGeoJSON,
  myTripsLayers,
  type MyTrips,
  intercityRoad,
  roadBounds,
  roadGeoJSON,
  roadKm,
  roadLayers,
  roadProgress,
  type Road,
} from './pieces.js';
import { roadsFromFeatures as fromGolden } from './index.js';
import { closedStreetsGeoJSON, closedStreetsLayers } from './closed-streets.js';
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
    expect(fromGolden).toBe(roadsFromFeatures);
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

describe('your trips map (stats «خريطتك»)', () => {
  const at = (p: [number, number]) => ({ lng: p[0], lat: p[1] });
  const trips: MyTrips = {
    home: at(PIN),
    kitchens: [{ ...at(offsetMetres(PIN, 400, 300)), count: 12 }, { ...at(offsetMetres(PIN, -300, 200)), count: 2 }],
    traces: [
      { service: 'food', from: at(offsetMetres(PIN, 400, 300)), to: at(PIN), count: 12, path: [at(offsetMetres(PIN, 400, 300)), at(offsetMetres(PIN, 400, 0)), at(PIN)] },
      { service: 'tuktuk', from: at(PIN), to: at(offsetMetres(PIN, 600, -100)), count: 1 },
      { service: 'rajaa', from: at(offsetMetres(PIN, -800, 600)), to: { lng: 44.3661, lat: 33.3152 }, count: 2 },
      { service: 'rajaa', from: at(offsetMetres(PIN, 500, 600)), to: { lng: 45.8206, lat: 32.5128 }, count: 1 },
    ],
  };
  const labels = { baghdad: 'لبغداد', kut: 'للكوت' };
  const parts = (fc: { features: { properties: Record<string, unknown> }[] }) => fc.features.map((f) => f.properties.part);
  it('draws trips along their streets, the arrows towards the right city, kitchens and home', () => {
    const fc = myTripsGeoJSON(trips, { labels });
    expect(parts(fc).filter((p) => p === 'trip')).toHaveLength(2);
    expect(fc.features.filter((f) => f.properties.part === 'label').map((f) => f.properties.label)).toEqual(['للكوت', 'لبغداد']);
    expect(fc.features.find((f) => f.properties.part === 'kitchen')!.properties.n).toBe('12');
    expect(parts(fc)).toContain('home');
    // the habit is drawn last and thickest, the one-off thin
    const lines = fc.features.filter((f) => f.properties.part === 'trip');
    expect(lines.map((f) => f.properties.w)).toEqual([3, 7.5]);
    // the food trip follows its streets (round the corner), the tuktuk trip with no route is a straight line
    expect(lines[1]!.geometry.coordinates).toHaveLength(3);
    expect(lines[0]!.geometry.coordinates).toHaveLength(2);
    // the arrow leaves its garage and stops 650 m out, inside the fitted view
    const away = fc.features.find((f) => f.properties.part === 'away')!.geometry.coordinates as [number, number][];
    expect(metresBetween(away[0]!, away[1]!)).toBeCloseTo(650, -1);
    const [[w, s], [e, n]] = myTripsBounds(trips)!;
    expect(away[1]![0]).toBeGreaterThanOrEqual(w); expect(away[1]![0]).toBeLessThanOrEqual(e);
    expect(away[1]![1]).toBeGreaterThanOrEqual(s); expect(away[1]![1]).toBeLessThanOrEqual(n);
  });
  it('draws once: nothing at the start, pins only after the lines', () => {
    expect(parts(myTripsGeoJSON(trips, { labels, k: 0 }))).toEqual([]);
    const half = myTripsGeoJSON(trips, { labels, k: 0.5 });
    // half drawn: the food trip has covered half of its 700 m of streets, so it is still on the first street
    const food = half.features.find((f) => f.properties.w === 7.5)!.geometry.coordinates as [number, number][];
    expect(metresBetween(food[0]!, food.at(-1)!)).toBeCloseTo(300, -1);
    expect(parts(half)).not.toContain('kitchen');
    expect(parts(half)).not.toContain('label');
    expect(parts(myTripsGeoJSON(trips, { labels, k: 1, pins: true }))).toContain('kitchen');
    expect(myTripsBounds({ home: null, kitchens: [], traces: [] })).toBeNull();
    expect(myTripWidth(1)).toBe(3); expect(myTripWidth(3)).toBe(5); expect(myTripWidth(9)).toBe(7.5);
  });
  it('makes valid layers in both lights, never blue', () => {
    for (const light of ['golden', 'day'] as const) {
      expect(valid(myTripsLayers({ source: 't', light }), ['t'])).toEqual([]);
      noBlue(myTripsLayers({ source: 't', light }));
    }
  });
});

describe('the road to Baghdad and Kut (N13)', () => {
  const towns = (r: ReturnType<typeof intercityRoad>) => r.towns.map((t) => t.nameAr);
  it('follows the real road from every garage, with its towns in order', () => {
    for (const g of ['bab1', 'bab2', 'souq'] as const) {
      const b = intercityRoad(g, 'baghdad');
      expect(b.totalM / 1000).toBeGreaterThan(70); expect(b.totalM / 1000).toBeLessThan(90);
      expect(towns(b)).toEqual(['الحفرية', 'الوحدة', 'بسماية', 'جسر ديالى', 'الزعفرانية', 'بغداد']);
      const k = intercityRoad(g, 'kut');
      expect(k.totalM / 1000).toBeGreaterThan(80); expect(k.totalM / 1000).toBeLessThan(95);
      expect(towns(k)).toEqual(['الدبوني', 'الكوت']);
      // starts at its garage and ends at the city garage
      expect(metresBetween(b.path[0]!, ({ bab1: [45.0405, 32.91575], bab2: [45.0641, 32.9155], souq: [45.0666, 32.9021] } as const)[g])).toBeLessThan(60);
      expect(metresBetween(b.path.at(-1)!, [44.4165, 33.3344])).toBeLessThan(150);
      expect(metresBetween(k.path.at(-1)!, [45.8189, 32.5126])).toBeLessThan(150);
    }
  });
  it('the way back runs the other way and ends in Aziziyah', () => {
    const out = intercityRoad('bab2', 'baghdad');
    const back = intercityRoad('bab2', 'baghdad', 'to_aziziyah');
    expect(back.path[0]).toEqual(out.path.at(-1));
    expect(back.totalM).toBeCloseTo(out.totalM, 3);
    expect(towns(back)).toEqual(['الزعفرانية', 'جسر ديالى', 'بسماية', 'الوحدة', 'الحفرية', 'العزيزية']);
  });
  it('says the next town and its km from a position or from km driven', () => {
    const r = intercityRoad('bab2', 'baghdad');
    const start = roadProgress(r, { m: 0 });
    expect(start.next!.town.nameAr).toBe('الحفرية');
    expect(start.passed).toEqual([]);
    const hafriya = r.towns[0]!;
    // just past الحفرية: the next is الوحدة
    const past = roadProgress(r, { m: hafriya.m + 1000 });
    expect(past.next!.town.nameAr).toBe('الوحدة');
    expect(past.passed.map((t) => t.nameAr)).toEqual(['الحفرية']);
    expect(roadKm(past.next!.inM)).toBe(Math.round((r.towns[1]!.m - hafriya.m - 1000) / 1000));
    // a GPS fix 40 m off the road lands on it
    const mid = r.path[Math.floor(r.path.length / 2)]!;
    const fix = roadProgress(r, offsetMetres(mid, 40, 0));
    expect(Math.abs(fix.m - roadProgress(r, mid).m)).toBeLessThan(60);
    // at the end there is nothing next
    expect(roadProgress(r, { m: r.totalM }).next).toBeNull();
    expect(roadProgress(r, { m: r.totalM + 5000 }).leftM).toBe(0);
    expect(roadKm(0)).toBe(0); expect(roadKm(200)).toBe(1); expect(roadKm(12_600)).toBe(13);
  });
  it('splits driven from ahead and marks the next town with the app words', () => {
    const r = intercityRoad('souq', 'kut');
    const fc = roadGeoJSON(r, { m: 20_000, labelOf: (t, inM) => `${t.nameAr} · ${roadKm(inM)} كم` });
    const part = (p: string) => fc.features.filter((f) => f.properties.part === p);
    expect(part('driven')).toHaveLength(1); expect(part('ahead')).toHaveLength(1); expect(part('car')).toHaveLength(1);
    const next = part('town').find((f) => f.properties.next)!;
    expect(next.properties.name).toBe('الدبوني');
    expect(next.properties.label).toMatch(/^الدبوني · \d+ كم$/);
    expect(part('town').find((f) => f.properties.kind === 'city')!.properties.label).toBe('الكوت');
    // nothing driven yet: no gold line and no car
    const fresh = roadGeoJSON(r);
    expect(fresh.features.some((f) => f.properties.part === 'driven' || f.properties.part === 'car')).toBe(false);
    const [[w, s], [e, n]] = roadBounds(r);
    expect(w).toBeLessThan(45.1); expect(e).toBeGreaterThan(45.8); expect(s).toBeLessThan(32.52); expect(n).toBeGreaterThan(32.9);
  });
  it('makes valid layers in both lights, never blue', () => {
    for (const light of ['golden', 'night'] as const) {
      expect(valid(roadLayers({ source: 'r', light }), ['r'])).toEqual([]);
      noBlue(roadLayers({ source: 'r', light }));
    }
  });
});

describe('closed streets (N20)', () => {
  const a = offsetMetres(PIN, 0, 0), b = offsetMetres(PIN, 120, 0), c = offsetMetres(PIN, 160, 0);
  const street = { id: 'cs1', path: [a, b, c].map(([lng, lat]) => ({ lat, lng })), reason: 'water', nameAr: null };
  const fc = closedStreetsGeoJSON([street, { id: 'short', path: [{ lat: 32.9, lng: 45 }] }], () => 'مسدود اليوم · تصليح ماي');

  it('draws the stretch, a barrier and a dot at each end, and one label mid-stretch', () => {
    const parts = fc.features.map((f) => f.properties.part);
    expect(parts.filter((p) => p === 'closed')).toHaveLength(1);
    expect(parts.filter((p) => p === 'bar')).toHaveLength(2);
    expect(parts.filter((p) => p === 'end')).toHaveLength(2);
    const label = fc.features.find((f) => f.properties.part === 'label')!;
    expect(label.properties.label).toBe('مسدود اليوم · تصليح ماي');
    expect(metresBetween(label.geometry.coordinates as [number, number], a)).toBeCloseTo(80, 0);
  });

  it('puts each barrier square across the street, 12 m wide', () => {
    const bar = fc.features.find((f) => f.properties.part === 'bar')!.geometry.coordinates as [number, number][];
    expect(metresBetween(bar[0]!, bar[1]!)).toBeCloseTo(12, 0);
    // the street runs east–west here, so the barrier runs north–south through the end
    expect(Math.abs(bar[0]![0] - bar[1]![0])).toBeLessThan(1e-6);
  });

  it('leaves out a street with fewer than two points', () => {
    expect(fc.features.some((f) => f.properties.id === 'short')).toBe(false);
  });

  it('has valid layers in every light, with no blue', () => {
    for (const light of ['day', 'golden', 'night'] as const) {
      const layers = closedStreetsLayers({ source: 'cs', light });
      expect(valid(layers, ['cs'])).toEqual([]);
      noBlue(layers);
    }
  });
});
