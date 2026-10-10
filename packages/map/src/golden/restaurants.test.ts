import { describe, expect, it } from 'vitest';
import {
  faceRoad,
  RESTAURANT_KINDS,
  RESTAURANT_PARTS,
  RESTAURANT_SOURCES,
  restaurantColour,
  restaurantHouseFilter,
  restaurantKindOf,
  restaurantLayers,
  restaurantScene,
} from './restaurants.js';
import type { GoldenLight } from './sun.js';

const LIGHTS: GoldenLight[] = ['day', 'morning', 'golden', 'sunset', 'night'];
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.04) return null;
  const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
};
const shop = { id: 'khalid', at: [45.0627, 32.9143] as [number, number], facing: 112, kind: 'grill' as const };

describe('restaurant models', () => {
  it('colours every part of every kind in every light, never blue or teal', () => {
    for (const light of LIGHTS) for (const kind of RESTAURANT_KINDS) for (const part of RESTAURANT_PARTS) {
      const c = restaurantColour(part, kind, light);
      expect(c, `${light}.${kind}.${part}`).toMatch(/^#[0-9A-F]{6}$/i);
      const h = hue(c);
      if (h !== null) expect(h < 160 || h > 260, `${light}.${kind}.${part} ${c}`).toBe(true);
    }
  });

  it('builds a model per shop, hangs the lantern only on the chosen one, and casts no shadow at night', () => {
    const plain = restaurantScene([shop]);
    const chosen = restaurantScene([shop], { selectedId: 'khalid' });
    expect(plain.solid.features.length).toBeGreaterThan(90);
    expect(chosen.solid.features.length).toBeGreaterThan(plain.solid.features.length);
    for (const f of plain.solid.features) expect(f.properties).toMatchObject({ id: 'khalid', c: expect.any(String), h: expect.any(Number), b: expect.any(Number) });
    expect(plain.soft.features.some((f) => f.properties?.sh === 1)).toBe(true);
    expect(restaurantScene([shop], { light: 'night' }).soft.features.some((f) => f.properties?.sh === 1)).toBe(false);
    expect(chosen.glow.features[0]?.properties).toMatchObject({ s: 1 });
  });

  it('every kind shows its own wares', () => {
    const sizes = RESTAURANT_KINDS.map((kind) => restaurantScene([{ ...shop, kind }]).solid.features.length);
    expect(new Set(sizes).size).toBeGreaterThan(4);
  });

  it('stands the shop behind its pin, facing the street', () => {
    const north = restaurantScene([{ ...shop, facing: 0 }]).solid.features;
    const lats = north.flatMap((f) => f.geometry.coordinates[0]!.map((c) => c[1]!));
    // the building goes back (south) from the pin, the pavement and tables come forward (north) only a little
    expect(Math.min(...lats)).toBeLessThan(shop.at[1] - 0.0001);
    expect(Math.max(...lats) - shop.at[1]).toBeLessThan(Math.abs(Math.min(...lats) - shop.at[1]));
  });

  it('draws with layers on the three sources', () => {
    const layers = restaurantLayers('golden');
    const sources = new Set(layers.map((l) => (l as { source: string }).source));
    expect([...sources].sort()).toEqual(Object.values(RESTAURANT_SOURCES).sort());
  });
});

describe('placing', () => {
  it('turns a shop to its nearest street', () => {
    const at: [number, number] = [45.06, 32.91];
    const south = { cls: 'major', coords: [[45.059, 32.9099], [45.061, 32.9099]] as [number, number][] };
    const east = { cls: 'alley', coords: [[45.06012, 32.909], [45.06012, 32.911]] as [number, number][] };
    expect(faceRoad(at, [south])).toBe(180);
    expect(faceRoad(at, [south, east])).toBe(180); // the alley is nearer but a main street wins
  });

  it('hides the house under each shop and, when one is chosen, the houses across its street', () => {
    expect(restaurantHouseFilter([shop])[0]).toBe('>');
    expect(restaurantHouseFilter([shop], 'khalid')[0]).toBe('all');
  });

  it('reads the kind from the food tags', () => {
    expect(restaurantKindOf(['مشويات', 'كص'])).toBe('grill');
    expect(restaurantKindOf(['شاورما'])).toBe('shawarma');
    expect(restaurantKindOf(['صمون حار'])).toBe('bakery');
    expect(restaurantKindOf(['كنافة'])).toBe('sweets');
    expect(restaurantKindOf(['عصير'])).toBe('juice');
    expect(restaurantKindOf(['شاي'])).toBe('cafe');
    expect(restaurantKindOf(['تمن ومرق'])).toBe('home');
    expect(restaurantKindOf(['بيتزا'])).toBe('restaurant');
  });
});
