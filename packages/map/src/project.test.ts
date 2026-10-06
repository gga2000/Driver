import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT, metresPerDegLng } from './geo.js';
import { fitProjection, svgPoints, SVG_FIT_MAX_ASPECT, SVG_FIT_MIN_ASPECT, SVG_FIT_PADDING_PX } from './project.js';

const LAT = 32.9;
/** A square of `sideM` metres with its south-west corner at (LAT, 45.0). */
function square(sideM: number) {
  const dLat = sideM / M_PER_DEG_LAT;
  const dLng = sideM / metresPerDegLng(LAT);
  return [
    { lat: LAT, lng: 45 },
    { lat: LAT, lng: 45 + dLng },
    { lat: LAT + dLat, lng: 45 + dLng },
    { lat: LAT + dLat, lng: 45 },
  ];
}

describe('fitProjection', () => {
  it('keeps ground proportions: a square of ground is a square on screen, inside the padding', () => {
    const pts = square(2000);
    const p = fitProjection(pts, 400);
    const w = p.x(pts[1]!.lng) - p.x(pts[0]!.lng);
    const h = p.y(pts[0]!.lat) - p.y(pts[3]!.lat);
    expect(Math.abs(w - h)).toBeLessThan(0.5); // the square is measured at its south edge, the map at its middle
    expect(p.height).toBe(400); // square ground → square box
    for (const q of pts) {
      expect(p.x(q.lng)).toBeGreaterThanOrEqual(SVG_FIT_PADDING_PX - 1e-9);
      expect(p.x(q.lng)).toBeLessThanOrEqual(400 - SVG_FIT_PADDING_PX + 1e-9);
      expect(p.y(q.lat)).toBeGreaterThanOrEqual(SVG_FIT_PADDING_PX - 1e-9);
      expect(p.y(q.lat)).toBeLessThanOrEqual(p.height - SVG_FIT_PADDING_PX + 1e-9);
    }
  });

  it('north is up and east is right', () => {
    const p = fitProjection(square(1000), 300);
    expect(p.y(LAT + 0.001)).toBeLessThan(p.y(LAT));
    expect(p.x(45.001)).toBeGreaterThan(p.x(45));
  });

  it('bounds the box shape for a long thin town, without squashing the zones', () => {
    const wide = [{ lat: LAT, lng: 45 }, { lat: LAT + 0.001, lng: 45.2 }];
    const p = fitProjection(wide, 500);
    expect(p.height).toBe(Math.round((500 - 2 * SVG_FIT_PADDING_PX) * SVG_FIT_MIN_ASPECT + 2 * SVG_FIT_PADDING_PX));
    const tall = [{ lat: LAT, lng: 45 }, { lat: LAT + 0.2, lng: 45.001 }];
    const q = fitProjection(tall, 500);
    expect(q.height).toBe(Math.round((500 - 2 * SVG_FIT_PADDING_PX) * SVG_FIT_MAX_ASPECT + 2 * SVG_FIT_PADDING_PX));
    // One scale on both axes: 1 km north equals 1 km east on screen.
    const kmNorth = q.y(LAT) - q.y(LAT + 1000 / M_PER_DEG_LAT);
    const kmEast = q.x(45 + 1000 / metresPerDegLng(LAT + 0.1)) - q.x(45);
    expect(kmNorth).toBeCloseTo(kmEast, 1);
  });

  it('a single point or nothing still gives a usable box, centred', () => {
    const one = fitProjection([{ lat: LAT, lng: 45 }], 200);
    expect(one.x(45)).toBeCloseTo(100);
    expect(one.y(LAT)).toBeCloseTo(one.height / 2);
    const none = fitProjection([], 200);
    expect(none.height).toBeGreaterThan(0);
    expect(none.x(45)).toBe(100);
  });

  it('svgPoints writes x,y pairs with one decimal', () => {
    expect(svgPoints([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], { x: (lng) => lng * 10, y: (lat) => lat + 0.04 })).toBe('20.0,1.0 40.0,3.0');
  });
});
