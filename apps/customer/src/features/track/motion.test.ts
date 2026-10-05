import { describe, expect, it } from 'vitest';
import type { LngLat } from './geo';
import { BACKTRACK_HOLD_M, buildPath, glidePos, headingAt, planGlide, pointAt, projectOnPath, remainingFrom, tailSpan, type Glide } from './motion';

const O: LngLat = { lat: 32.905, lng: 45.06 };
const M = 111_320;
/** `east` / `north` metres from O. */
const at = (east: number, north: number): LngLat => ({ lat: O.lat + north / M, lng: O.lng + east / (M * Math.cos((O.lat * Math.PI) / 180)) });
// An L-shaped road: 200 m east, then 200 m north.
const path = buildPath([at(0, 0), at(200, 0), at(200, 200)])!;

describe('road path maths', () => {
  it('measures the path and finds points along it', () => {
    expect(path.length).toBeCloseTo(400, 0);
    const p = pointAt(path, 300);
    expect(p.lat).toBeCloseTo(at(200, 100).lat, 6);
    expect(p.lng).toBeCloseTo(at(200, 100).lng, 6);
    expect(pointAt(path, -5)).toEqual(path.pts[0]);
    expect(pointAt(path, 9_999)).toEqual(path.pts[2]);
  });
  it('heading follows the road and turns smoothly at the corner', () => {
    expect(headingAt(path, 50)).toBeCloseTo(90, 0);
    expect(headingAt(path, 350)).toBeCloseTo(0, 0);
    const corner = headingAt(path, 196);
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeLessThan(90);
  });
  it('projects a point onto the road and keeps what is still ahead', () => {
    const p = projectOnPath(path, at(120, 10));
    expect(p.d).toBeCloseTo(120, 0);
    expect(p.offM).toBeCloseTo(10, 0);
    expect(remainingFrom(path, 300)).toHaveLength(2);
    expect(remainingFrom(path, 100)).toHaveLength(3);
  });
});

describe('planGlide', () => {
  const still = (d: number) => ({ pos: pointAt(path, d), heading: 90, d });

  it('on the road: glides along it, with a dead-reckoning tail while moving', () => {
    const g = planGlide(path, still(100), { ...at(150, 3), speedKmh: 36 }, 2_000);
    expect(g).toMatchObject({ kind: 'path', fromD: 100 });
    const p = g as Extract<Glide, { kind: 'path' }>;
    expect(p.toD).toBeCloseTo(150, 0);
    expect(p.tailPerT).toBeCloseTo(20, 5);
    expect(p.tailM).toBeCloseTo(120, 0);
    expect(tailSpan(g, 2_000)).toBeCloseTo(6, 5);
    expect(glidePos(g, path, 0.5).d).toBeCloseTo(125, 0);
    expect(glidePos(g, path, 2).d).toBeCloseTo(p.toD + 20, 0);
    expect(glidePos(g, path, 100).d).toBeCloseTo(p.toD + 120, 0);
  });
  it('waiting at a light: no tail', () => {
    const g = planGlide(path, still(100), { ...at(101, 0), speedKmh: 2 }, 2_000);
    expect(tailSpan(g, 2_000)).toBe(0);
  });
  it('a fix slightly behind the marker: hold still, never hop back', () => {
    const g = planGlide(path, still(150), { ...at(130, 0), speedKmh: 20 }, 2_000) as Extract<Glide, { kind: 'path' }>;
    expect(g.toD).toBe(150);
    const far = planGlide(path, still(150), { ...at(150 - BACKTRACK_HOLD_M - 20, 0), speedKmh: 20 }, 2_000) as Extract<Glide, { kind: 'path' }>;
    expect(far.toD).toBeLessThan(150);
  });
  it('off the road or without one: the straight glide, turning the short way', () => {
    const off = planGlide(path, still(100), { ...at(100, 80), bearing: 10 }, 2_000);
    expect(off).toMatchObject({ kind: 'line', toHeading: 10 });
    const none = planGlide(null, { pos: O, heading: 350, d: null }, { ...at(0, 50) }, 2_000);
    expect(none.kind).toBe('line');
    expect((none as Extract<Glide, { kind: 'line' }>).toHeading).toBeCloseTo(360, 0);
    expect(glidePos(none, null, 1).pos).toEqual(at(0, 50));
  });
  it('a road glide whose path went away finishes straight', () => {
    const g = planGlide(path, still(100), { ...at(150, 0), speedKmh: 20 }, 2_000);
    expect(glidePos(g, null, 1).pos.lng).toBeCloseTo(at(150, 0).lng, 6);
  });
});
