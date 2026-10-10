import { describe, expect, it } from 'vitest';
import type { RestaurantCard } from '@driver/contracts';
import { mapShops, tourStep } from './shops';

const card = (id: string, o: Partial<RestaurantCard>): RestaurantCard =>
  ({ id, open: true, etaMinMinutes: 20, prepMinMinutes: 10, opensInMin: null, pickup: { zoneKey: 'z', pin: { lat: 32.91, lng: 45.06 } }, ...o }) as RestaurantCard;

describe('restaurant map shops', () => {
  it('shows only kitchens with a pin, open and soonest first, closed by when they open', () => {
    const shops = mapShops([
      card('late', { etaMinMinutes: 40 }),
      card('nopin', { pickup: null }),
      card('closed-soon', { open: false, opensInMin: 30 }),
      card('soon', { etaMinMinutes: 15 }),
      card('closed-later', { open: false, opensInMin: 300 }),
    ]);
    expect(shops.map((s) => s.id)).toEqual(['soon', 'late', 'closed-soon', 'closed-later']);
    expect(shops[0]!.at).toEqual([45.06, 32.91]);
  });

  it('«الجاي» goes round the shops', () => {
    const shops = mapShops([card('a', { etaMinMinutes: 1 }), card('b', { etaMinMinutes: 2 })]);
    expect(tourStep(shops, null, 1)?.id).toBe('a');
    expect(tourStep(shops, 'b', 1)?.id).toBe('a');
    expect(tourStep(shops, 'a', -1)?.id).toBe('b');
  });
});
