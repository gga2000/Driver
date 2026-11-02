import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  bearingBetween, buildGoldenStyle, glintGradient, GOLDEN_FIRST_LABEL, goldenTrackingGroundLayers, goldenTrackingLayers, trackingArrowImage, trackingCamera,
  TRACKING_ARROW, TRACKING_UNDER_HOUSES,
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
  it('lays the route on the street under the houses, with a faint trace through them over the houses (look B)', () => {
    const style = buildGoldenStyle({ pmtilesUrl: 'pmtiles://x.test/w.pmtiles', glyphs: 'https://x.test/{fontstack}/{range}.pbf', light: 'golden', riseAt: TRACKING_RISE_ZOOM });
    style.sources.r = { ...empty, lineMetrics: true };
    style.sources.g = empty;
    style.sources.b = empty;
    const { under, over } = goldenTrackingGroundLayers({ service: 'food', light: 'golden', routeSource: 'r', glowSource: 'g', litSource: 'b' });
    style.layers.splice(style.layers.findIndex((l) => l.id === TRACKING_UNDER_HOUSES), 0, ...under);
    style.layers.splice(style.layers.findIndex((l) => l.id === GOLDEN_FIRST_LABEL), 0, ...over);
    expect(validateStyleMin(style)).toEqual([]);
    const at = (id: string) => style.layers.findIndex((l) => l.id === id);
    expect(at('track-ahead')).toBeLessThan(at('golden-houses-3d'));
    expect(at('track-through')).toBeGreaterThan(at('golden-houses-3d'));
    expect(at('track-lit')).toBeGreaterThan(at('golden-houses-3d'));
    expect(under.find((l) => l.type === 'symbol')?.layout).toMatchObject({ 'icon-image': TRACKING_ARROW, 'symbol-placement': 'line' });
  });
  it('keeps the default order map layers as they were (the new look is opt-in)', () => {
    const ids = goldenTrackingLayers({ service: 'food', light: 'golden', routeSource: 'r', glowSource: 'g', litSource: 'b' }).map((l) => l.id);
    expect(ids).toEqual(['track-glow', 'track-done', 'track-casing', 'track-plan', 'track-ahead', 'track-lit']);
  });
  it('draws the direction arrow as a dark chevron on clear pixels', () => {
    const img = trackingArrowImage('day');
    expect(img.data).toHaveLength(img.width * img.height * 4);
    const alpha = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]!;
    expect(alpha(16, 12)).toBeGreaterThan(200);
    expect(alpha(1, 1)).toBe(0);
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
