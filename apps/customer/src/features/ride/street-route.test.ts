import { describe, expect, it } from 'vitest';
import { buildStreetGraph, distanceWords, streetRoute, type LngLat } from './street-route';

// A small grid of streets ~100 m apart around Aziziyah, cut in two at a "tile seam" on x = 45.0610.
const X = [45.06, 45.061, 45.062];
const Y = [32.9, 32.9009, 32.9018];
const roads = [
  ...Y.map((y) => ({ cls: 'minor', coords: [[X[0]!, y], [45.0610, y]] as LngLat[] })),
  ...Y.map((y) => ({ cls: 'minor', coords: [[45.061 + 0.000005, y], [X[2]!, y]] as LngLat[] })),
  ...X.map((x) => ({ cls: 'minor', coords: Y.map((y) => [x, y]) as LngLat[] })),
];

describe('streetRoute', () => {
  const g = buildStreetGraph(roads);

  it('joins street pieces that meet at a tile seam', () => {
    const r = streetRoute(g, [45.06, 32.9], [45.062, 32.9]);
    expect(r).not.toBeNull();
    expect(r!.metres).toBeGreaterThan(180);
    expect(r!.metres).toBeLessThan(195);
  });

  it('goes round the block, not through it', () => {
    const r = streetRoute(g, [45.06, 32.9], [45.062, 32.9018])!;
    const straight = Math.hypot(0.002 * 93_400, 0.0018 * 110_540);
    expect(r.metres).toBeGreaterThan(straight + 50);
    expect(r.path[0]).toEqual([45.06, 32.9]);
  });

  it('snaps a pin in a yard onto the nearest street', () => {
    const r = streetRoute(g, [45.0601, 32.90005], [45.0619, 32.90175])!;
    expect(r.path.length).toBeGreaterThan(2);
    expect(r.to).toEqual([45.0619, 32.90175]);
  });

  it('gives up when the pin is far from every drawn street', () => {
    expect(streetRoute(g, [45.06, 32.9], [45.1, 32.95])).toBeNull();
  });

  it('goes straight along one street piece', () => {
    const r = streetRoute(g, [45.0602, 32.9], [45.0608, 32.9])!;
    expect(r.path).toHaveLength(2);
  });
});

describe('distanceWords', () => {
  it('says metres under a kilometre, kilometres above', () => {
    expect(distanceWords(30)).toEqual({ value: '50', unit: 'm' });
    expect(distanceWords(420)).toEqual({ value: '400', unit: 'm' });
    expect(distanceWords(2_437)).toEqual({ value: '2.4', unit: 'km' });
  });
});
