import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { goldenLifeLayers, LIFE_MINZOOM, lifeFrame, streetLife } from './index.js';

// a straight main street running north for ~550 m, and an alley that gets nothing
const main = { cls: 'major', coords: [[45.06, 32.905], [45.06, 32.91]] as [number, number][] };
const alley = { cls: 'alley', coords: [[45.061, 32.905], [45.061, 32.906]] as [number, number][] };

describe('street life', () => {
  it('is the same scene for the same street and seed', () => {
    expect(streetLife([main], { seed: 3 })).toEqual(streetLife([main], { seed: 3 }));
  });

  it('puts cars and people only on real streets, never in alleys, and fewer at night', () => {
    expect(streetLife([alley]).parked).toHaveLength(0);
    const day = streetLife([main]);
    const night = streetLife([main], { light: 'night' });
    expect(day.parked.length).toBeGreaterThan(10);
    expect(day.movers.length).toBeGreaterThan(0);
    expect(night.people.length).toBeLessThan(day.people.length);
  });

  it('keeps parked cars at the kerb and people on the pavement', () => {
    const life = streetLife([main]);
    const sideM = (lng: number) => Math.abs(lng - 45.06) * 111320 * Math.cos((32.9 * Math.PI) / 180);
    for (const c of life.parked) expect(sideM(c.at[0])).toBeCloseTo(3.9, 1);
    for (const p of life.people) expect(sideM(p.at[0])).toBeCloseTo(6.6, 1);
  });

  it('never uses saffron, yellow, blue or teal, so nothing looks like the courier or a ride', () => {
    const frame = lifeFrame(streetLife([main]), 0);
    for (const f of frame.features) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.properties.colour.slice(i, i + 2), 16)) as [number, number, number];
      expect(b > r && b > g).toBe(false); // no blue/teal
      expect(r > 200 && g > 120 && g < 200 && b < 80).toBe(false); // no saffron/orange
    }
  });

  it('moves cars and walkers over time, and stands still when motion is off', () => {
    const live = streetLife([main], { seed: 5 });
    expect(lifeFrame(live, 0)).not.toEqual(lifeFrame(live, 4));
    const still = streetLife([main], { seed: 5, moving: false });
    expect(still.movers).toHaveLength(0);
    expect(lifeFrame(still, 0)).toEqual(lifeFrame(still, 4));
  });

  it('shows only up close, as a valid layer', () => {
    const [layer] = goldenLifeLayers({ source: 'life' });
    expect(layer!.minzoom).toBe(LIFE_MINZOOM);
    expect(LIFE_MINZOOM).toBeGreaterThan(16);
    const style = { version: 8, sources: { life: { type: 'geojson', data: lifeFrame(streetLife([main]), 0) } }, layers: [layer] };
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});
