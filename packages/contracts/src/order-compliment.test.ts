import { describe, expect, it } from 'vitest';
import { COMPLIMENT_RULES, ComplimentInput, complimentKeysFor, complimentReason, complimentUntil, countCompliments } from './order-compliment.js';

const delivered = new Date('2026-10-07T12:00:00Z');
const later = (h: number) => new Date(delivered.getTime() + h * 3_600_000);
const rated = (delivery: number | null) => ({ delivery, food: null, tags: [], note: null, ratedAt: later(0.1) });

describe('compliments after a good rating (joy l4)', () => {
  it('each order type offers its own words', () => {
    expect(complimentKeysFor('food')).toEqual(['fast', 'polite', 'hot_food', 'found_home']);
    expect(complimentKeysFor('ride')).toEqual(['polite', 'smooth_ride', 'clean_car', 'fast']);
    expect(complimentKeysFor('parcel')).toEqual(['fast', 'polite', 'found_home']);
  });

  it('asked only once it reached him, he rated the courier 4–5, within a day', () => {
    expect(complimentReason({ state: 'picked_up', deliveredAt: null, rating: null }, later(0))).toBe('not_delivered');
    expect(complimentReason({ state: 'delivered', deliveredAt: delivered, rating: null }, later(0))).toBe('not_rated');
    expect(complimentReason({ state: 'closed', deliveredAt: delivered, rating: rated(null) }, later(0))).toBe('not_rated');
    expect(complimentReason({ state: 'closed', deliveredAt: delivered, rating: rated(3) }, later(0))).toBe('low_rating');
    expect(complimentReason({ state: 'closed', deliveredAt: delivered, rating: rated(4) }, later(1))).toBeNull();
    expect(complimentReason({ state: 'completed', deliveredAt: delivered, rating: rated(5) }, later(COMPLIMENT_RULES.windowHours))).toBeNull();
    expect(complimentReason({ state: 'closed', deliveredAt: delivered, rating: rated(5) }, later(COMPLIMENT_RULES.windowHours + 0.01))).toBe('window_closed');
    expect(complimentReason({ state: 'disputed', deliveredAt: delivered, rating: rated(5) }, later(1))).toBe('not_delivered');
    expect(complimentUntil({ deliveredAt: delivered })).toEqual(later(24));
  });

  it('one to four known words', () => {
    expect(ComplimentInput.safeParse({ orderId: 'o1', keys: [] }).success).toBe(false);
    expect(ComplimentInput.safeParse({ orderId: 'o1', keys: ['fast', 'polite', 'hot_food', 'found_home', 'clean_car'] }).success).toBe(false);
    expect(ComplimentInput.safeParse({ orderId: 'o1', keys: ['rude'] }).success).toBe(false);
    expect(ComplimentInput.safeParse({ orderId: 'o1', keys: ['fast'] }).success).toBe(true);
  });

  it('counts each customer once per word, most said first', () => {
    expect(countCompliments([{ keys: ['polite', 'fast'] }, { keys: ['polite'] }, { keys: ['hot_food', 'hot_food'] }])).toEqual([
      { key: 'polite', count: 2 },
      { key: 'fast', count: 1 },
      { key: 'hot_food', count: 1 },
    ]);
    expect(countCompliments([])).toEqual([]);
  });
});
