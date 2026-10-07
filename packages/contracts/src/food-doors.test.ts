import { describe, expect, it } from 'vitest';
import {
  doorMoment,
  doorOf,
  doorOrder,
  FOOD_DOORS,
  meltsOnTheWay,
  onlyIceCream,
  sellsIceCream,
} from './food-doors.js';
import { AZIZIYAH_RESTAURANTS } from './seeds/aziziyah-restaurants.js';
import { DEMO_SHOPS } from './seeds/demo-shops.js';

const at = (month: number, hour: number) => new Date(2026, month - 1, 14, hour, 30);

describe('food doors: one door per shop, from its tags', () => {
  it('every launch kitchen is a meal', () => {
    for (const r of AZIZIYAH_RESTAURANTS) expect(doorOf(r.tags), r.key).toBe('meal');
  });
  it('a restaurant with a dessert section stays a restaurant', () => {
    expect(doorOf(['grill', 'dessert'])).toBe('meal');
  });
  it('a café, a juice bar and a sweets shop each get their own door; the first tag decides a mix', () => {
    expect(doorOf(['coffee', 'cake'])).toBe('cafe');
    expect(doorOf(['juice', 'ice_cream'])).toBe('cold');
    expect(doorOf(['ice_cream'])).toBe('sweet');
    expect(doorOf(['kunafa', 'juice'])).toBe('sweet');
    expect(doorOf(['new', 'coffee'])).toBe('cafe');
    expect(doorOf([])).toBe('meal');
  });
  it('the demo shops cover every door', () => {
    expect(new Set([...AZIZIYAH_RESTAURANTS, ...DEMO_SHOPS].map((r) => doorOf(r.tags)))).toEqual(
      new Set(FOOD_DOORS),
    );
  });
});

describe('melt guard (idea i1)', () => {
  it('only an ice-cream-only shop, only past 20 minutes, only when the door time is known', () => {
    expect(onlyIceCream(['ice_cream'])).toBe(true);
    expect(onlyIceCream(['kunafa', 'ice_cream'])).toBe(false);
    expect(sellsIceCream(['kunafa', 'ice_cream'])).toBe(true);
    expect(meltsOnTheWay({ tags: ['ice_cream'], etaMaxMinutes: 21 })).toBe(true);
    expect(meltsOnTheWay({ tags: ['ice_cream'], etaMaxMinutes: 20 })).toBe(false);
    expect(meltsOnTheWay({ tags: ['ice_cream'], etaMaxMinutes: null })).toBe(false);
    expect(meltsOnTheWay({ tags: ['kunafa', 'ice_cream'], etaMaxMinutes: 40 })).toBe(false);
  });
});

describe('door order by the hour and the season (ideas d4, j1, i5)', () => {
  it('breakfast and lunch lead with meals, the afternoon with tea, the evening with dinner', () => {
    expect(doorOrder(at(1, 8))[0]).toBe('meal');
    expect(doorOrder(at(1, 13))).toEqual(['meal', 'cold', 'cafe', 'sweet']);
    expect(doorOrder(at(1, 16))[0]).toBe('cafe');
    expect(doorOrder(at(1, 22))).toEqual(['meal', 'sweet', 'cafe', 'cold']);
    expect(doorMoment(at(1, 3))).toBe('late');
    expect(doorMoment(at(1, 23))).toBe('evening');
    expect(doorOrder(at(1, 3))[0]).toBe('meal');
  });
  it('a summer afternoon starts cold and a summer night starts with ice cream', () => {
    expect(doorMoment(at(7, 14))).toBe('summer_noon');
    expect(doorOrder(at(7, 14))[0]).toBe('cold');
    expect(doorMoment(at(8, 22))).toBe('summer_night');
    expect(doorOrder(at(8, 22))[0]).toBe('sweet');
    expect(doorMoment(at(6, 1))).toBe('summer_night');
    expect(doorMoment(at(10, 14))).toBe('noon');
  });
  it('always all four doors', () => {
    for (let h = 0; h < 24; h++)
      for (const m of [1, 7])
        expect([...doorOrder(at(m, h))].sort()).toEqual([...FOOD_DOORS].sort());
  });
});
