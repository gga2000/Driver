import { describe, expect, it } from 'vitest';
import { inRing, litBuilding, routeGeoJSON, routeParts } from './map3d';
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
