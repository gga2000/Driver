import { describe, expect, it } from 'vitest';
import { closedStreetsGeoJSON } from '@driver/map/pieces/closed-streets';
import { closedDetourLine, closuresOnMap, inRing, litBuilding, routeGeoJSON, routeParts, slowStretchPath, slowStretchShape } from './map3d';
import { buildPath } from './motion';

const road = buildPath([
  { lat: 32.9, lng: 45.06 },
  { lat: 32.901, lng: 45.06 },
  { lat: 32.901, lng: 45.062 },
])!;

describe('3D order map: route parts', () => {
  it('kitchen: the way he will come, from the kitchen to the door', () => {
    const p = routeParts('kitchen', road, { kitchen: { lat: 32.9005, lng: 45.06 }, door: null, d: null });
    expect(p.done).toBeNull();
    expect(p.ahead).toBeNull();
    expect(p.plan![0]![1]).toBeCloseTo(32.9005, 5);
    expect(p.plan!.at(-1)).toEqual([45.062, 32.901]);
  });
  it('on the way: driven part and the road ahead meet where he is', () => {
    const p = routeParts('on_the_way', road, { kitchen: null, door: null, d: 50 });
    expect(p.plan).toBeNull();
    expect(p.done!.at(-1)).toEqual(p.ahead![0]);
    expect(p.ahead!.at(-1)).toEqual([45.062, 32.901]);
  });
  it('arrived (or no road): nothing drawn', () => {
    expect(routeGeoJSON(routeParts('arrived', road, { kitchen: null, door: null, d: 10 })).features).toHaveLength(0);
    expect(routeGeoJSON(routeParts('near', null, { kitchen: null, door: null, d: 10 })).features).toHaveLength(0);
  });
  it('no road shape: the same parts, drawn straight', () => {
    const kitchen = { lat: 32.9, lng: 45.06 };
    const door = { lat: 32.91, lng: 45.07 };
    const courier = { lat: 32.905, lng: 45.065 };
    const k = routeParts('kitchen', null, { kitchen, door, d: null });
    expect(k.plan).toEqual([[45.06, 32.9], [45.07, 32.91]]);
    const w = routeParts('on_the_way', null, { kitchen, door, d: null, courier });
    expect(w.done).toEqual([[45.06, 32.9], [45.065, 32.905]]);
    expect(w.ahead).toEqual([[45.065, 32.905], [45.07, 32.91]]);
  });
  it('each part carries its name for the map layers', () => {
    const fc = routeGeoJSON(routeParts('near', road, { kitchen: null, door: null, d: 50 }));
    expect(fc.features.map((f) => f.properties?.part)).toEqual(['done', 'ahead']);
  });
});

describe('3D order map: the lit building', () => {
  const ring: [number, number][] = [
    [45.0, 32.9],
    [45.001, 32.9],
    [45.001, 32.901],
    [45.0, 32.901],
    [45.0, 32.9],
  ];
  it('point in polygon', () => {
    expect(inRing([45.0005, 32.9005], ring)).toBe(true);
    expect(inRing([45.002, 32.9005], ring)).toBe(false);
  });
  it('lights the house under the pin, else a small block of 6 m', () => {
    const hit = litBuilding({ lat: 32.9005, lng: 45.0005 }, [{ ring, hm: 9 }]);
    expect(hit.features[0]!.properties).toEqual({ hm: 9 });
    const stand = litBuilding({ lat: 32.95, lng: 45.1 }, [{ ring, hm: 9 }]);
    expect(stand.features[0]!.properties).toEqual({ hm: 6 });
  });
});

describe('3D order map: the slow stretch (N6)', () => {
  const line = (s: ReturnType<typeof slowStretchShape>) => (s.line.features[0]?.geometry as GeoJSON.LineString | undefined)?.coordinates ?? null;
  it('stripes the stretch between its metres, with the label at its middle', () => {
    const s = slowStretchShape(road, { fromM: 20, toM: 100 });
    const c = line(s)!;
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c[0]![1]).toBeCloseTo(32.9 + 20 / 111_320, 5);
    expect(s.mid!.lat).toBeCloseTo(32.9 + 60 / 111_320, 5);
  });
  it('only the part still ahead of him: behind him is not striped, all behind him is nothing', () => {
    expect(line(slowStretchShape(road, { fromM: 20, toM: 100 }, 60))![0]![1]).toBeCloseTo(32.9 + 60 / 111_320, 5);
    expect(slowStretchShape(road, { fromM: 20, toM: 100 }, 95)).toEqual({ line: { type: 'FeatureCollection', features: [] }, mid: null });
  });
  it('no stretch, no line: nothing drawn', () => {
    expect(slowStretchShape(road, null).mid).toBeNull();
    expect(slowStretchShape(null, { fromM: 0, toM: 50 }).line.features).toHaveLength(0);
  });
  it('a stretch past the end of the road is cut at the door', () => {
    const c = line(slowStretchShape(road, { fromM: 200, toM: 9_999 }))!;
    expect(c.at(-1)).toEqual([45.062, 32.901]);
  });
  it('without a road shape, the straight line from where the route started through the stops ahead', () => {
    const v = { trip: null, dropoff: { pin: { lat: 32.901, lng: 45.06 } }, merchant: { pin: { lat: 32.9, lng: 45.06 } }, order: { state: 'preparing', deliveredAt: null }, courier: null } as never;
    const p = slowStretchPath(null, v, null)!;
    expect(p.pts).toEqual([{ lat: 32.9, lng: 45.06 }, { lat: 32.901, lng: 45.06 }]);
    expect(slowStretchPath(road, v, null)).toBe(road);
  });
});

describe('N20 closed streets: the map and the sheet line', () => {
  const street = (id: string, extraMin: number, nameAr: string | null = null) => ({
    id,
    path: [
      { lat: 32.9, lng: 45.06 },
      { lat: 32.9005, lng: 45.0605 },
    ],
    reason: 'works' as const,
    nameAr,
    endsAt: new Date('2026-10-11T20:00:00Z'),
    extraMin,
  });
  it('draws the closed streets until he is at the door', () => {
    expect(closuresOnMap('on_the_way', [street('a', 2)])).toHaveLength(1);
    expect(closuresOnMap('kitchen', [street('a', 2)])).toHaveLength(1);
    expect(closuresOnMap('arrived', [street('a', 2)])).toHaveLength(0);
    expect(closuresOnMap('near', undefined)).toHaveLength(0);
  });
  it('the shared piece gets the stretch, both barriers and the short label', () => {
    const fc = closedStreetsGeoJSON(closuresOnMap('on_the_way', [street('a', 2)]), () => 'شارع مسدود');
    const parts = fc.features.map((f) => f.properties.part);
    expect(parts.filter((p) => p === 'closed')).toHaveLength(1);
    expect(parts.filter((p) => p === 'bar')).toHaveLength(2);
    expect(fc.features.find((f) => f.properties.part === 'label')?.properties.label).toBe('شارع مسدود');
  });
  it('one line: generic, or the costliest street by name', () => {
    expect(closedDetourLine([street('a', 2)], null)).toEqual({ key: 'track.closed_detour' });
    expect(closedDetourLine([street('a', 1, 'شارع السوق'), street('b', 4, ' شارع الجسر ')], null)).toEqual({ key: 'track.closed_detour_named', name: 'شارع الجسر' });
    expect(closedDetourLine([street('a', 4), street('b', 1, 'شارع السوق')], 'traffic')).toEqual({ key: 'track.closed_detour' });
  });
  it('nothing without closures, or when the late banner already says a closed street', () => {
    expect(closedDetourLine(undefined, null)).toBeNull();
    expect(closedDetourLine([], null)).toBeNull();
    expect(closedDetourLine([street('a', 2, 'شارع السوق')], 'closed')).toBeNull();
  });
});
