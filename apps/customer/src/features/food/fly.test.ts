import { describe, expect, it } from 'vitest';
import { EMPTY_CART, ME, addLine, type CartMerchant, type CartState } from './cart';
import { FLIGHT_END_SCALE, FLIGHT_LIFT, flightPoint, flightScale, stackThumbs } from './fly';

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 };

describe('flightPoint: a quadratic arc from the card to the bubble', () => {
  const from = { x: 300, y: 400 };
  const to = { x: 60, y: 780 };
  it('starts on the card and lands on the bubble', () => {
    expect(flightPoint(from, to, 0)).toEqual(from);
    expect(flightPoint(from, to, 1)).toEqual(to);
  });
  it('rises above both ends on the way (the control point is 120 px over the higher end)', () => {
    const mid = flightPoint(from, to, 0.25);
    expect(mid.y).toBeLessThan(from.y);
    expect(flightPoint({ x: 0, y: 100 }, { x: 200, y: 100 }, 0.5)).toEqual({ x: 100, y: 100 - FLIGHT_LIFT / 2 });
  });
});

describe('flightScale', () => {
  it('shrinks from full size to a bubble', () => {
    expect(flightScale(0)).toBe(1);
    expect(flightScale(1)).toBeCloseTo(FLIGHT_END_SCALE);
  });
});

describe('stackThumbs', () => {
  it('the newest three dishes, one each, newest first', () => {
    let cart: CartState = EMPTY_CART;
    for (const id of ['a', 'b', 'a', 'c', 'd']) {
      const r = addLine(cart, KHALID, { itemId: id, name: id, basePriceIqd: 1000, modifiers: [], qty: 1, note: id === 'a' ? String(Math.random()) : null, personId: ME });
      if (r.ok) cart = r.cart;
    }
    expect(stackThumbs(cart).map((l) => l.itemId)).toEqual(['d', 'c', 'a']);
  });
});
