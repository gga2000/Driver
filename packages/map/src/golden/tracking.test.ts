import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  bearingBetween, buildGoldenStyle, glintGradient, GOLDEN_FIRST_LABEL, goldenTrackingLayers, trackingCamera,
  TRACKING_RISE_ZOOM, type TrackingMoment,
} from './index.js';

const KITCHEN: [number, number] = [45.0606, 32.9097];
const DOOR: [number, number] = [45.051811, 32.907747];
const COURIER: [number, number] = [45.05549, 32.908908];
const empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as const;

describe('the order map', () => {
  it('builds a valid style with the town risen early and the tracking layers under the labels', () => {
    const style = buildGoldenStyle({ pmtilesUrl: 'pmtiles://x.test/w.pmtiles', glyphs: 'https://x.test/{fontstack}/{range}.pbf', light: 'golden', riseAt: TRACKING_RISE_ZOOM });
    expect(style.layers.find((l) => l.id === 'golden-houses-3d')?.minzoom).toBe(TRACKING_RISE_ZOOM);
    style.sources.r = { ...empty, lineMetrics: true };
    style.sources.g = empty;
    style.sources.b = empty;
    const at = style.layers.findIndex((l) => l.id === GOLDEN_FIRST_LABEL);
    style.layers.splice(at, 0, ...goldenTrackingLayers({ service: 'food', light: 'golden', routeSource: 'r', glowSource: 'g', litSource: 'b' }));
    expect(validateStyleMin(style)).toEqual([]);
  });
  it('tilts every moment into 3D and heads the camera the way the food travels', () => {
    const pts = { from: KITCHEN, to: DOOR, vehicle: COURIER };
    for (const m of ['kitchen', 'on_the_way', 'near', 'arrived'] as TrackingMoment[]) {
      expect(trackingCamera(m, pts).pitch, m).toBeGreaterThanOrEqual(45);
    }
    expect(trackingCamera('kitchen', pts).bearing).toBeCloseTo(bearingBetween(KITCHEN, DOOR));
    expect(trackingCamera('on_the_way', pts).bearing).toBeCloseTo(bearingBetween(COURIER, DOOR));
    expect(trackingCamera('on_the_way', pts).bounds).toEqual([[DOOR[0], COURIER[1] < DOOR[1] ? COURIER[1] : DOOR[1]], [COURIER[0], Math.max(COURIER[1], DOOR[1])]]);
    expect(trackingCamera('arrived', pts).center).toEqual(DOOR);
  });
  it('points north at 0 and east at 90', () => {
    expect(bearingBetween([45, 32], [45, 33])).toBeCloseTo(0);
    expect(bearingBetween([45, 32], [46, 32])).toBeCloseTo(90);
  });
  it('rests the route without a glint and keeps the glint inside the line', () => {
    expect(glintGradient('food', 'golden', null)).toHaveLength(7);
    const g = glintGradient('food', 'golden', 1) as unknown[];
    const stops = g.slice(3).filter((_, i) => i % 2 === 0) as number[];
    expect(stops.every((s, i) => i === 0 || s > stops[i - 1]!)).toBe(true);
    expect(Math.max(...stops)).toBe(1);
  });
});
