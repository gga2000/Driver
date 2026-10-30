import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { CART_CLOSED, CART_KINDS, CART_SOURCES, cartLayers, cartModel, cartScene, type MapCart } from './carts.js';
import { metresBetween } from './metres.js';

const AT: [number, number] = [45.0655, 32.903];
const cart = (over: Partial<MapCart> = {}): MapCart => ({ id: 'c1', kind: 'liver', at: AT, open: true, ...over });

describe('food carts on the map', () => {
  it('builds every kind with its wares, about 3.2 times life size', () => {
    for (const kind of CART_KINDS) {
      const parts = new Set(cartModel(kind, { open: true, lit: false }).map((p) => p.part));
      for (const p of ['wood', 'tire', 'pole', 'awnA', 'awnB', 'gas']) expect(parts.has(p as never), `${kind} ${p}`).toBe(true);
    }
    expect(cartModel('tea', { open: true, lit: false }).filter((p) => p.part === 'stool')).toHaveLength(3);
    expect(cartModel('corn', { open: true, lit: false }).some((p) => p.part === 'corn')).toBe(true);
    const sc = cartScene([cart()]);
    const top = Math.max(...sc.solid.features.map((f) => f.properties!.h as number));
    expect(top).toBeCloseTo(2.36 * 3.2, 1);
    // the whole cart stays within a few metres of its spot
    for (const f of sc.solid.features) for (const c of f.geometry.coordinates[0]!) expect(metresBetween(c as [number, number], AT)).toBeLessThan(8);
  });
  it('a closed cart is grey, unlit, without smoke or glow; an open one glows, more when chosen', () => {
    const shut = cartScene([cart({ open: false })], { light: 'night' });
    expect(new Set(shut.solid.features.map((f) => f.properties!.c))).toEqual(new Set([CART_CLOSED]));
    expect(shut.soft.features).toEqual([]);
    expect(shut.glow.features).toEqual([]);
    const open = cartScene([cart(), cart({ id: 'c2' })], { light: 'night', selectedId: 'c2' });
    expect(open.glow.features.map((f) => f.properties!.s)).toEqual([0, 1]);
    expect(open.soft.features.length).toBeGreaterThan(0);
    // the bulb burns only at night
    const bulbs = (light: 'day' | 'night') => cartScene([cart()], { light }).solid.features.filter((f) => f.properties!.c === (light === 'night' ? '#FFE6A8' : '#FFE1A0')).length;
    expect(bulbs('night')).toBe(bulbs('day') + 1);
  });
  it('turns to face its street', () => {
    // facing east: the tea stools (on the street side) sit east of the cart
    const sc = cartScene([cart({ kind: 'tea', facing: 90 })]);
    const stools = sc.solid.features.filter((f) => f.properties!.h === 0.45 * 3.2);
    for (const s of stools) expect((s.geometry.coordinates[0]![0] as number[])[0]!).toBeGreaterThan(AT[0]);
  });
  it('makes valid layers in every light', () => {
    for (const light of ['day', 'golden', 'night'] as const) {
      const style = {
        version: 8 as const,
        sources: Object.fromEntries(Object.values(CART_SOURCES).map((s) => [s, { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } }])),
        layers: cartLayers(light),
      };
      expect(validateStyleMin(style)).toEqual([]);
    }
  });
});
