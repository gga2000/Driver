import { describe, expect, it } from 'vitest';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import {
  bestCells,
  bestThree,
  compareRows,
  doorFact,
  doorShops,
  isFoodDoor,
  showBest,
  showTools,
} from './doors';

function shop(id: string, over: Partial<RestaurantSummary> = {}): RestaurantSummary {
  return {
    id,
    name: id,
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

describe('doorShops', () => {
  const list = [
    shop('grill', { etaMaxMinutes: 40 }),
    shop('fav', { favourite: true, etaMaxMinutes: 50 }),
    shop('cafe', { tags: ['coffee'] }),
    shop('kunafa', { tags: ['sweets', 'ice_cream'], etaMaxMinutes: 45 }),
    shop('far-ice', { tags: ['ice_cream'], etaMaxMinutes: 35 }),
    shop('near-ice', { tags: ['ice_cream'], etaMaxMinutes: 15 }),
    shop('late', { open: false, opensAt: '5:00', opensInMin: 300 }),
    shop('soon', { open: false, opensAt: '1:00', opensInMin: 60 }),
  ];
  it('a shop sits behind exactly one door; yours first, then the faster', () => {
    expect(doorShops(list, 'meal').open.map((r) => r.id)).toEqual(['fav', 'grill']);
    expect(doorShops(list, 'cafe').open.map((r) => r.id)).toEqual(['cafe']);
    expect(doorShops(list, 'cold').open).toEqual([]);
  });
  it('closed shops: who opens first', () => {
    expect(doorShops(list, 'meal').closed.map((r) => r.id)).toEqual(['soon', 'late']);
  });
  it('melt guard: a far ice-cream-only shop is named, not listed; a sweets shop with ice cream stays', () => {
    const s = doorShops(list, 'sweet');
    expect(s.open.map((r) => r.id)).toEqual(['near-ice', 'kunafa']);
    expect(s.melted.map((r) => r.id)).toEqual(['far-ice']);
  });
  it('the door fact: open count, else first to open, else none', () => {
    expect(doorFact(list, 'meal')).toEqual({ kind: 'open', n: 2 });
    expect(
      doorFact(
        [shop('a', { open: false, opensAt: '4:00', opensInMin: 10, tags: ['juice'] })],
        'cold',
      ),
    ).toEqual({ kind: 'opens', at: '4:00' });
    expect(doorFact(list, 'cold')).toEqual({ kind: 'none' });
  });
});

describe('bestThree', () => {
  it('each pick has its own true reason', () => {
    const picks = bestThree([
      shop('a', { rating: 4.2, etaMaxMinutes: 25 }),
      shop('b', { rating: 4.8 }),
      shop('c', { rating: 4.1, etaMaxMinutes: 18 }),
      shop('d', { favourite: true, rating: 3.9 }),
    ]);
    expect(picks.map((p) => [p.shop.id, p.reason])).toEqual([
      ['d', 'yours'],
      ['b', 'rated'],
      ['c', 'fastest'],
    ]);
  });
  it('a new shop is never called the best rated; free delivery and new get their say', () => {
    const picks = bestThree([
      shop('rated', { rating: 4.6, etaMaxMinutes: 18 }),
      shop('free', { rating: 4.0, deliveryFeeIqd: 0 }),
      shop('fresh', { rating: null, ratingCount: 0 }),
    ]);
    expect(picks.map((p) => [p.shop.id, p.reason])).toEqual([
      ['rated', 'rated'],
      ['free', 'free'],
      ['fresh', 'new'],
    ]);
  });
  it('only one shop is ever «the best rated»; the others say their own rating', () => {
    const picks = bestThree([shop('haj', { rating: 4.8, ratingCount: 90 }), shop('sham', { rating: 4.5, etaMaxMinutes: 15 }), shop('khalid', { rating: 4.7 }), shop('musafir', { rating: 4.6 })]);
    expect(picks.filter((p) => p.reason === 'rated')).toHaveLength(1);
    expect(picks.map((p) => [p.shop.id, p.reason])).toEqual([
      ['haj', 'rated'],
      ['sham', 'fastest'],
      ['khalid', 'score'],
    ]);
  });
  it('same input, same three', () => {
    const list = [
      shop('x', { rating: 4.5 }),
      shop('y', { rating: 4.5 }),
      shop('z', { rating: 4.5 }),
      shop('w', { rating: 4.5 }),
    ];
    expect(bestThree(list).map((p) => p.shop.id)).toEqual(
      bestThree([...list].reverse()).map((p) => p.shop.id),
    );
    expect(bestThree(list)).toHaveLength(3);
  });
  it('fewer than three shops: just those', () => {
    expect(bestThree([shop('only')])).toHaveLength(1);
    expect(bestThree([])).toEqual([]);
  });
});

describe('calm tools (k6) and when «أحسن 3» shows', () => {
  it('tools only past 8 open shops; the three only past 3', () => {
    expect(showTools(8)).toBe(false);
    expect(showTools(9)).toBe(true);
    expect(showBest(3)).toBe(false);
    expect(showBest(4)).toBe(true);
  });
});

describe('compare (k2)', () => {
  it('marks the single best cell of each row; ties and unknowns mark nothing', () => {
    const rows = compareRows(
      bestThree([
        shop('a', { rating: 4.8, etaMaxMinutes: 30 }),
        shop('b', { rating: 4.2, etaMaxMinutes: 20, deliveryFeeIqd: null }),
        shop('c', { rating: 4.0, etaMaxMinutes: 30 }),
      ]),
    );
    const best = bestCells(rows);
    expect(best.rating).toBe('a');
    expect(best.minutes).toBe('b');
    expect(best.fee).toBeNull();
    expect(best.minOrder).toBeNull();
  });
});

describe('route param', () => {
  it('only the four doors', () => {
    expect(['meal', 'cafe', 'cold', 'sweet'].every(isFoodDoor)).toBe(true);
    expect(isFoodDoor('pizza')).toBe(false);
  });
});
