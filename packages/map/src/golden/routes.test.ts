import { contrastRatio } from '@driver/design-tokens';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { buildGoldenStyle, GOLDEN_FIRST_LABEL, GOLDEN_PALETTES, goldenRouteLayers, serviceInk, type GoldenLight, type MapService } from './index.js';

const SERVICES: MapService[] = ['food', 'taxi', 'tuktuk', 'trips', 'back'];
const LIGHTS: GoldenLight[] = ['day', 'morning', 'golden', 'sunset', 'night'];

describe('service routes on the Golden hour map', () => {
  it('stand out from the land and the streets in every light (3:1, the non-text contrast bar)', () => {
    for (const light of LIGHTS) {
      const p = GOLDEN_PALETTES[light];
      for (const s of SERVICES) {
        const ink = serviceInk(s, light);
        for (const ground of [p.land, p.urban, p.major]) {
          const best = Math.max(contrastRatio(ink.route, ground), contrastRatio(ink.edge, ground));
          expect(best, `${s} on ${light} ${ground}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
  it('slot under the labels into a valid style, ids prefixed so two trips can share a map', () => {
    const style = buildGoldenStyle({ pmtilesUrl: 'pmtiles://x.test/w.pmtiles', glyphs: 'https://x.test/{fontstack}/{range}.pbf', light: 'golden' });
    const layers = goldenRouteLayers({ service: 'food', light: 'golden', routeSource: 'r', pinSource: 'p', id: 'order' });
    const at = style.layers.findIndex((l) => l.id === GOLDEN_FIRST_LABEL);
    style.sources.r = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    style.sources.p = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    style.layers.splice(at, 0, ...layers);
    expect(validateStyleMin(style)).toEqual([]);
    expect(layers.every((l) => l.id.startsWith('order-'))).toBe(true);
    // the road ahead draws over its edge, and the vehicle over everything else of the trip
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf('order-line')).toBeGreaterThan(ids.indexOf('order-edge'));
    expect(ids.at(-1)).toBe('order-vehicle');
  });
  it('uses the service colours from the design tokens, brighter at night', () => {
    expect(serviceInk('food', 'golden').route).toBe('#F7A33B');
    expect(serviceInk('tuktuk', 'night').route).not.toBe(serviceInk('tuktuk', 'day').route);
  });
});
