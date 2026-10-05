import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from './aziziyah-zones.js';
import type { LatLng } from './common.js';
import {
  draftRing,
  fromLocalM,
  openRing,
  overlapAreaM2,
  pointInRing,
  ringAreaM2,
  ringCentroid,
  ringSelfIntersects,
  ZONE_OVERLAP_TOLERANCE_M2,
  zoneServiceBounds,
  zoneShapeProblem,
} from './zone-geometry.js';

const ORIGIN: LatLng = { lat: 32.905, lng: 45.06 };
/** Axis-aligned square, `side` metres, south-west corner `dx`/`dy` metres from ORIGIN. */
const square = (side: number, dx = 0, dy = 0): LatLng[] =>
  [
    { x: dx, y: dy },
    { x: dx + side, y: dy },
    { x: dx + side, y: dy + side },
    { x: dx, y: dy + side },
  ].map((q) => fromLocalM(q, ORIGIN));
const bounds = zoneServiceBounds('aziziyah')!;

describe('zone geometry', () => {
  it('area of a 100 m square is 10,000 m²; a closing point changes nothing', () => {
    const s = square(100);
    expect(ringAreaM2(s)).toBeCloseTo(10_000, -1);
    expect(ringAreaM2([...s, s[0]!])).toBeCloseTo(10_000, -1);
    expect(openRing([...s, s[0]!])).toHaveLength(4);
  });

  it('centroid of a square is its middle', () => {
    const c = ringCentroid(square(100));
    const mid = fromLocalM({ x: 50, y: 50 }, ORIGIN);
    expect(c.lat).toBeCloseTo(mid.lat, 6);
    expect(c.lng).toBeCloseTo(mid.lng, 6);
  });

  it('point in ring', () => {
    expect(pointInRing(fromLocalM({ x: 50, y: 50 }, ORIGIN), square(100))).toBe(true);
    expect(pointInRing(fromLocalM({ x: 150, y: 50 }, ORIGIN), square(100))).toBe(false);
  });

  it('a bow-tie crosses itself; a square and an L-shape do not', () => {
    const [a, b, c, d] = square(100) as [LatLng, LatLng, LatLng, LatLng];
    expect(ringSelfIntersects([a, c, b, d])).toBe(true);
    expect(ringSelfIntersects(square(100))).toBe(false);
    const l = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ].map((q) => fromLocalM(q, ORIGIN));
    expect(ringSelfIntersects(l)).toBe(false);
  });

  it('overlap: half-shifted squares share half; touching or apart share nothing; inside shares all', () => {
    expect(overlapAreaM2(square(200), square(200, 100))).toBeCloseTo(20_000, -2);
    expect(overlapAreaM2(square(200), square(200, 200))).toBeLessThan(ZONE_OVERLAP_TOLERANCE_M2);
    expect(overlapAreaM2(square(200), square(200, 500))).toBe(0);
    expect(overlapAreaM2(square(300), square(100, 100, 100))).toBeCloseTo(10_000, -2);
  });

  it('shape problems, in order', () => {
    const ok = square(300);
    const mid = fromLocalM({ x: 150, y: 150 }, ORIGIN);
    expect(zoneShapeProblem(ok, mid, bounds, [])).toBeNull();
    expect(zoneShapeProblem(ok.slice(0, 2), mid, bounds, [])).toEqual({ kind: 'too_few_points' });
    const [a, b, c, d] = ok as [LatLng, LatLng, LatLng, LatLng];
    expect(zoneShapeProblem([a, c, b, d], mid, bounds, [])).toEqual({ kind: 'self_crossing' });
    expect(zoneShapeProblem(square(50), fromLocalM({ x: 25, y: 25 }, ORIGIN), bounds, [])).toMatchObject({ kind: 'too_small' });
    expect(zoneShapeProblem(ok, fromLocalM({ x: 900, y: 900 }, ORIGIN), bounds, [])).toEqual({ kind: 'centre_outside' });
    expect(zoneShapeProblem([{ lat: 10, lng: 10 }, ...ok.slice(1)], mid, bounds, [])).toEqual({ kind: 'outside_service_area' });
    expect(zoneShapeProblem(ok, mid, bounds, [{ key: 'street_30', ring: square(300, 150) }])).toMatchObject({ kind: 'overlap', withKey: 'street_30' });
    expect(zoneShapeProblem(ok, mid, bounds, [{ key: 'street_30', ring: square(300, 300) }])).toBeNull();
  });

  it('draft ring is the seed hexagon: 6 corners around the seed centre, centre inside', () => {
    const z = AZIZIYAH_ZONES[0]!;
    const ring = draftRing(z);
    expect(ring).toHaveLength(6);
    expect(ring[0]!.lat).toBeCloseTo(z.lat, 6);
    expect(pointInRing({ lat: z.lat, lng: z.lng }, ring)).toBe(true);
  });

  it('service bounds cover every seed zone and nothing for unknown cities', () => {
    for (const z of AZIZIYAH_ZONES) {
      expect(z.lat).toBeGreaterThan(bounds.minLat);
      expect(z.lng).toBeLessThan(bounds.maxLng);
    }
    expect(zoneServiceBounds('atlantis')).toBeNull();
  });
});
