import { describe, expect, it } from 'vitest';
import { restaurantFocusCamera, restaurantOverview, restaurantSettledCamera, restaurantTourStep, RESTAURANT_SETTLE_DEG } from './restaurant-tour.js';

describe('restaurant tour camera', () => {
  it('looks at the shop front from across the street, then turns a little once', () => {
    const shop = { at: [45.06, 32.91] as [number, number], facing: 0 };
    const c = restaurantFocusCamera(shop);
    expect(c.center).toEqual(shop.at);
    expect(c.bearing).toBe(-160); // street to the north: the camera looks south at the front, 20° to one side
    expect(restaurantSettledCamera(shop).bearing - c.bearing).toBe(RESTAURANT_SETTLE_DEG);
  });

  it('frames every shop from above', () => {
    expect(restaurantOverview([])).toBeNull();
    const o = restaurantOverview([{ at: [45.05, 32.9] }, { at: [45.07, 32.92] }])!;
    expect(o.bounds).toEqual([[45.05, 32.9], [45.07, 32.92]]);
  });

  it('goes round the shops with «الجاي» and back', () => {
    const shops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(restaurantTourStep(shops, null, 1)?.id).toBe('a');
    expect(restaurantTourStep(shops, 'c', 1)?.id).toBe('a');
    expect(restaurantTourStep(shops, 'a', -1)?.id).toBe('c');
    expect(restaurantTourStep([], 'a', 1)).toBeNull();
  });
});
