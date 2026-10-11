import { describe, expect, it } from 'vitest';
import { fitCamera } from './fit.js';

const A: [number, number] = [45.0558, 32.9018];
const B: [number, number] = [45.0715, 32.9095];

describe('fitCamera (phones: fit with a heading and a zoom cap)', () => {
  it('centres two points and zooms so both fit', () => {
    const c = fitCamera([A, B], { width: 390, height: 844 });
    expect(c.center[0]).toBeCloseTo((A[0] + B[0]) / 2, 4);
    expect(c.center[1]).toBeCloseTo((A[1] + B[1]) / 2, 3);
    // 1.5 km across 390 px is about zoom 14.
    expect(c.zoom).toBeGreaterThan(13.5);
    expect(c.zoom).toBeLessThan(15);
  });

  it('caps the zoom and keeps one point centred', () => {
    const c = fitCamera([A], { width: 390, height: 844, maxZoom: 17.2 });
    expect(c.zoom).toBe(17.2);
    expect(c.center[0]).toBeCloseTo(A[0], 6);
  });

  it('zooms out more when padding takes room, and shifts the centre away from the bigger pad', () => {
    const plain = fitCamera([A, B], { width: 390, height: 844 });
    const padded = fitCamera([A, B], { width: 390, height: 844, padding: { top: 80, bottom: 300, left: 40, right: 40 } });
    expect(padded.zoom).toBeLessThan(plain.zoom);
    // More padding at the bottom: the camera looks further south so the points sit higher.
    expect(padded.center[1]).toBeLessThan(plain.center[1]);
  });

  it('fits the box as turned by the heading', () => {
    const north = fitCamera([A, B], { width: 390, height: 844, bearing: 0 });
    const turned = fitCamera([A, B], { width: 390, height: 844, bearing: 90 });
    // East-west spread sits across the narrow screen at 0°, along the tall side at 90°: closer then.
    expect(turned.zoom).toBeGreaterThan(north.zoom);
    expect(turned.center[0]).toBeCloseTo(north.center[0], 4);
  });
});
