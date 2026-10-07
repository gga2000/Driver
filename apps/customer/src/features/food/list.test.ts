import { describe, expect, it } from 'vitest';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { activeFilterCount, applyList, cuisineOptions, hasFreeDelivery, hasRatings } from './list';

const r = (p: Partial<RestaurantSummary> & { id: string }): RestaurantSummary => ({
  name: p.id,
  cityId: 'aziziyah',
  pickup: null,
  cuisine: '',
  zoneId: null,
  rating: null,
  ratingCount: 0,
  prepMinMinutes: 20,
  prepMaxMinutes: 30,
  etaMinMinutes: null,
  etaMaxMinutes: null,
  deliveryFeeIqd: null,
  minOrderIqd: 5000,
  open: true,
  favourite: false,
  tags: [],
  dealCount: 0,
  ...p,
});

const khalid = r({ id: 'khalid', rating: 4.7, ratingCount: 300, prepMinMinutes: 20, etaMinMinutes: 35, deliveryFeeIqd: 500, tags: ['grill', 'kebab'] });
const kareem = r({ id: 'kareem', rating: 4.8, ratingCount: 527, prepMinMinutes: 25, etaMinMinutes: 30, deliveryFeeIqd: 0, tags: ['grill', 'chicken', 'rice'] });
const sham = r({ id: 'sham', rating: null, prepMinMinutes: 15, etaMinMinutes: 32, deliveryFeeIqd: 1000, tags: ['shawarma'], dealCount: 1 });
const musafir = r({ id: 'musafir', open: false, opensAt: '5:00', rating: 4.5, etaMinMinutes: 40, tags: ['breakfast', 'rice'] });
const all = [khalid, kareem, sham, musafir];
const ids = (xs: RestaurantSummary[]) => xs.map((x) => x.id);

describe('restaurant list (شوف الكل)', () => {
  it('keeps closed kitchens reachable in their own section, whatever the sort', () => {
    const out = applyList(all, 'nearest', {});
    expect(ids(out.closed)).toEqual(['musafir']);
    expect(out.open).toHaveLength(3);
  });

  it('sorts nearest by the ride, fastest by door time, rating with new kitchens last', () => {
    // Rides: khalid 15, kareem 5, sham 17.
    expect(ids(applyList(all, 'nearest', {}).open)).toEqual(['kareem', 'khalid', 'sham']);
    expect(ids(applyList(all, 'fastest', {}).open)).toEqual(['kareem', 'sham', 'khalid']);
    expect(ids(applyList(all, 'rating', {}).open)).toEqual(['kareem', 'khalid', 'sham']);
  });

  it('without a place (guests), nearest falls back to prep time', () => {
    const noPlace = all.map((x) => ({ ...x, etaMinMinutes: null }));
    expect(ids(applyList(noPlace, 'nearest', {}).open)).toEqual(['sham', 'khalid', 'kareem']);
  });

  it('filters: open now, free delivery, deals, cuisine', () => {
    expect(applyList(all, 'nearest', { openNow: true }).closed).toEqual([]);
    expect(ids(applyList(all, 'nearest', { freeDelivery: true }).open)).toEqual(['kareem']);
    expect(ids(applyList(all, 'nearest', { deals: true }).open)).toEqual(['sham']);
    const rice = applyList(all, 'nearest', { cuisine: 'rice' });
    expect([...ids(rice.open), ...ids(rice.closed)]).toEqual(['kareem', 'musafir']);
    expect(activeFilterCount({ openNow: true, cuisine: 'rice' })).toBe(2);
  });

  it('offers only chips that find something', () => {
    expect(cuisineOptions(all)[0]).toBe('grill');
    expect(cuisineOptions(all)).toEqual(expect.arrayContaining(['rice', 'shawarma', 'breakfast']));
    expect(cuisineOptions([r({ id: 'x', tags: ['unknown_tag'] })])).toEqual([]);
    expect(hasRatings(all)).toBe(true);
    expect(hasRatings([sham])).toBe(false);
    expect(hasFreeDelivery(all)).toBe(true);
    expect(hasFreeDelivery([khalid, sham])).toBe(false);
  });
});
