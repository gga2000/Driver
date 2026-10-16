import { describe, expect, it } from 'vitest';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { headlineOf, isNight, streetOf, tagBox, TAG_SPOTS } from './landing';

function shop(id: string, over: Partial<RestaurantSummary> = {}): RestaurantSummary {
  return {
    id,
    name: id,
    cityId: 'aziziyah',
    pickup: null,
    cuisine: '',
    zoneId: null,
    rating: 4.5,
    ratingCount: 20,
    prepMinMinutes: 10,
    prepMaxMinutes: 20,
    etaMinMinutes: 20,
    etaMaxMinutes: 30,
    deliveryFeeIqd: 1000,
    minOrderIqd: 3000,
    open: true,
    favourite: false,
    tags: ['grill'],
    dealCount: 0,
    ...over,
  };
}

// January: never the summer orders.
const evening = new Date(2026, 0, 10, 20, 30);
const small = new Date(2026, 0, 10, 4, 26);

describe('streetOf', () => {
  it('counts the open shops behind all four doors and keeps the hour order', () => {
    const s = streetOf([shop('a'), shop('b'), shop('tea', { tags: ['tea'] }), shop('shut', { open: false, opensAt: '9:00', opensInMin: 600 })], evening);
    expect(s.openCount).toBe(3);
    expect(s.asleep).toBe(false);
    expect(s.order[0]).toBe('meal');
    expect(s.facts.meal).toEqual({ kind: 'open', n: 2 });
    expect(s.facts.cold).toEqual({ kind: 'none' });
  });

  it('asleep when nothing is open, naming the first shop to open', () => {
    const s = streetOf(
      [shop('late', { open: false, opensAt: '7:00', opensInMin: 150 }), shop('soon', { open: false, opensAt: '5:00', opensInMin: 34, tags: ['tea'] })],
      small,
    );
    expect(s.asleep).toBe(true);
    expect(s.firstOpen).toEqual({ at: '5:00', door: 'cafe' });
    expect(headlineOf(s)).toEqual({ one: 'food.landing.asleep', two: 'food.landing.opens_at', time: '5:00' });
    expect(isNight(s)).toBe(true);
  });

  it('in the small hours with one door lit, says that door is still open', () => {
    const s = streetOf([shop('kitchen', { open: false, opensAt: '5:00', opensInMin: 34 }), shop('tea', { tags: ['tea'] })], small);
    expect(s.onlyOpen).toBe('cafe');
    expect(headlineOf(s)).toEqual({ one: 'food.landing.asleep', two: 'food.landing.only.cafe' });
  });

  it("an ordinary evening reads the hour's own two lines", () => {
    const s = streetOf([shop('a'), shop('tea', { tags: ['tea'] })], evening);
    expect(s.onlyOpen).toBeNull();
    expect(headlineOf(s)).toEqual({ one: 'food.landing.h1.evening', two: 'food.landing.h2.evening' });
    expect(isNight(s)).toBe(false);
  });

  it('an empty town has nothing to open', () => {
    expect(headlineOf(streetOf([], small))).toEqual({ one: 'food.landing.asleep', two: 'food.landing.back_soon' });
  });
});

describe('tagBox', () => {
  const photo = { width: 390, height: 697, top: -28 };
  it('centres a tag over its shop', () => {
    const b = tagBox(TAG_SPOTS.cold, photo, 100);
    expect(b.pointX).toBeCloseTo(167.7);
    expect(b.left).toBeCloseTo(117.7);
  });
  it('keeps the tag on the screen at the edges, its point still on the shop', () => {
    const b = tagBox(TAG_SPOTS.cafe, photo, 130);
    expect(b.left).toBe(390 - 8 - 130);
    expect(b.pointX).toBeCloseTo(339.3);
  });
  it('no two tags share a spot', () => {
    const xs = Object.values(TAG_SPOTS).map((s) => s.x);
    expect(new Set(xs).size).toBe(4);
  });
});
