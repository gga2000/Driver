import { describe, expect, it } from 'vitest';
import type { MenuItem, QuoteComponent } from '@driver/contracts';
import { EMPTY_CART, ME, addLine, type CartMerchant, type CartState } from './cart';
import { checkoutTotals } from './checkout';
import { minOrderProgress } from './min-order';
import { priceItems } from './price-lines';
import { upsellItems } from './upsell';

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 };
const comp = (key: QuoteComponent['key'], amount: number): QuoteComponent => ({ key, amount, label_ar: key, label_en: key, driverShareRule: 'driver_full', visibility: 'shown' });
const QUOTE = { components: [comp('service_fee', 500), comp('base', 1000)] };

function item(id: string, name: string, priceIqd: number): MenuItem {
  return { id, name, description: null, priceIqd, photoUrl: null, available: true, unavailableReason: null, prepTimeMin: 5, pointsEligible: true, modifierGroups: [] };
}

function cartWith(lines: Array<[string, string, number, number?]>): CartState {
  let cart: CartState = EMPTY_CART;
  for (const [itemId, name, basePriceIqd, qty] of lines) {
    const r = addLine(cart, KHALID, { itemId, name, basePriceIqd, modifiers: [], qty: qty ?? 1, note: null, personId: ME });
    if (r.ok) cart = r.cart;
  }
  return cart;
}

/** The plain-key translator the tests read: `key {param=value}`. */
const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ')}` : key);

describe('minimum-order progress (f11)', () => {
  it('how far the basket is and what is left; nothing once met or without a minimum', () => {
    expect(minOrderProgress(3_250, 5_000)).toEqual({ doneIqd: 3_250, shortIqd: 1_750, ratio: 0.65 });
    expect(minOrderProgress(0, 5_000)).toEqual({ doneIqd: 0, shortIqd: 5_000, ratio: 0 });
    expect(minOrderProgress(5_000, 5_000)).toBeNull();
    expect(minOrderProgress(3_000, 0)).toBeNull();
  });
});

describe('totals with the small-order fee and points (J-D6, f13)', () => {
  it('adds the server small-order fee and takes off the server points; cash rounds after both', () => {
    const cart = cartWith([['wrap', 'لفة كباب', 2000]]);
    const t1 = checkoutTotals(cart, QUOTE, { discountIqd: 0, discount: null, smallOrderFeeIqd: 500, smallOrder: { minOrderIqd: 5000, feeIqd: 500 }, pointsIqd: 0 });
    expect(t1).toMatchObject({ itemsIqd: 2000, smallOrderFeeIqd: 500, smallOrderMinIqd: 5000, pointsIqd: 0, priceIqd: 4000, totalIqd: 4000 });
    const t2 = checkoutTotals(cart, QUOTE, { discountIqd: 0, discount: null, smallOrderFeeIqd: 500, smallOrder: { minOrderIqd: 5000, feeIqd: 500 }, pointsIqd: 1_120 });
    expect(t2).toMatchObject({ pointsIqd: 1_120, priceIqd: 2_880, totalIqd: 3_000, changeIqd: 120 });
    // Older API without the fields: nothing added.
    expect(checkoutTotals(cart, QUOTE, { discountIqd: 0, discount: null })).toMatchObject({ smallOrderFeeIqd: 0, smallOrderMinIqd: null, pointsIqd: 0, priceIqd: 3500 });
  });

  it('price lines: the named small-order fee with its reason, then points as a minus line', () => {
    const cart = cartWith([['wrap', 'لفة كباب', 2000]]);
    const totals = checkoutTotals(cart, QUOTE, { discountIqd: 0, discount: null, smallOrderFeeIqd: 500, smallOrder: { minOrderIqd: 5000, feeIqd: 500 }, pointsIqd: 600 });
    const lines = priceItems(totals, t, 'ar-IQ');
    expect(lines.map((l) => [l.key, l.amount])).toEqual([
      ['items', 2000],
      ['base', 1000],
      ['service_fee', 500],
      ['small_order', 500],
      ['points', -600],
    ]);
    expect(lines.find((l) => l.key === 'small_order')).toMatchObject({ label: 'quote.small_order_fee', reason: 'quote.reason.small_order amount=5,000' });
    expect(lines.find((l) => l.key === 'points')?.label).toBe('quote.points');
    // The lines add up to the price.
    expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(totals.priceIqd);
  });
});

describe('cart upsell ranking (F-15)', () => {
  const categories = [
    { name: 'لفات', items: [item('wrap', 'لفة كباب', 2000), item('tikka', 'لفة تكة', 2500)] },
    { name: 'وجبات', items: [item('plate', 'وجبة كباب', 6000), item('mix', 'مشكّل', 15000)] },
    { name: 'مقبلات', items: [item('soup', 'شوربة عدس', 1000), item('salad', 'سلطة خضرة', 1000)] },
    { name: 'مشروبات', items: [item('pepsi', 'بيبسي', 750), item('laban', 'شنينة', 750)] },
  ];

  it('below the minimum: dishes that close the gap in one add first (closest first), then drinks', () => {
    const cart = cartWith([['wrap', 'لفة كباب', 2000], ['soup', 'شوربة عدس', 1000], ['x', 'صنف', 250]]); // 3,250 of 5,000: short 1,750
    const ids = upsellItems(categories, cart, 1_750).map((i) => i.id);
    expect(ids.slice(0, 3)).toEqual(['tikka', 'plate', 'mix']);
    expect(ids.indexOf('plate')).toBeLessThan(ids.indexOf('pepsi'));
    expect(ids).not.toContain('wrap');
    expect(ids).not.toContain('soup');
  });

  it('nothing closes the gap: drinks first', () => {
    const cart = cartWith([['wrap', 'لفة كباب', 2000]]);
    const ids = upsellItems(categories, cart, 20_000).map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual(['pepsi', 'laban']);
  });

  it('minimum met and no drink yet: drinks first; with a drink, sides first; never what is in the cart', () => {
    expect(upsellItems(categories, cartWith([['plate', 'وجبة كباب', 6000]]), 0).map((i) => i.id).slice(0, 2)).toEqual(['pepsi', 'laban']);
    const withDrink = upsellItems(categories, cartWith([['plate', 'وجبة كباب', 6000], ['pepsi', 'بيبسي', 750]]), 0).map((i) => i.id);
    expect(withDrink.slice(0, 2)).toEqual(['soup', 'salad']);
    expect(withDrink).not.toContain('pepsi');
    expect(withDrink).not.toContain('plate');
    expect(withDrink.length).toBeLessThanOrEqual(6);
  });
});
