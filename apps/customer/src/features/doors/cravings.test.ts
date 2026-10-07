import { describe, expect, it } from 'vitest';
import type { CatalogSearchDish } from '@driver/contracts';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { cravingPicks, cravingRow, doorCravings, hourWords, usualOrder } from './cravings';

function shop(id: string, tags: string[], extra: Partial<RestaurantSummary> = {}): RestaurantSummary {
  return { id, name: id, cityId: 'aziziyah', pickup: null, cuisine: '', zoneId: null, rating: 4.5, ratingCount: 20, prepMinMinutes: 5, prepMaxMinutes: 10, etaMinMinutes: 15, etaMaxMinutes: 20, deliveryFeeIqd: 1500, minOrderIqd: 2000, open: true, favourite: false, tags, dealCount: 0, ...extra };
}
function dish(id: string, restaurantId: string, name = id): CatalogSearchDish {
  return { id, name, description: null, priceIqd: 3000, photoUrl: null, available: true, quickAdd: true, restaurantId, restaurantName: restaurantId, restaurantOpen: true, restaurantOpensAt: null };
}

// Monday 6 October 2026 (no summer), local clock.
const at = (h: number, month = 9) => new Date(2026, month, 6, h, 0);

describe('«شنو بخاطرك؟» kinds per door', () => {
  it('meals in the morning start with breakfast; the day starts with grills', () => {
    expect(doorCravings('meal', at(8))[0]!.key).toBe('pacha');
    expect(doorCravings('meal', at(13))[0]!.key).toBe('kebab');
    expect(doorCravings('meal', at(13)).length).toBe(9);
  });
  it('sweets: ice cream first on a summer night (i5), كليچة and زلابية first in Ramadan and Eid (s5)', () => {
    expect(doorCravings('sweet', at(22, 6))[0]!.key).toBe('ice_cream');
    expect(doorCravings('sweet', at(22))[0]!.key).toBe('kunafa');
    expect(doorCravings('sweet', at(17), { kind: 'ramadan' }).slice(0, 2).map((k) => k.key)).toEqual(['kleicha', 'zalabia']);
  });
  it('coffee: iced first on a summer afternoon (j1)', () => {
    expect(doorCravings('cafe', at(15, 7))[0]!.key).toBe('iced_latte');
    expect(doorCravings('cafe', at(9))[0]!.key).toBe('tea');
  });
});

describe('the picture row', () => {
  const shops = [shop('cafe', ['coffee', 'cake']), shop('sweets', ['sweets', 'kunafa'])];
  const kinds = doorCravings('sweet', at(13));
  it('keeps shops behind this door only and kinds someone has now', () => {
    const row = cravingRow(kinds, [
      { key: 'kunafa', dishes: [dish('k1', 'sweets')] },
      { key: 'cake', dishes: [dish('c1', 'cafe')] },
      { key: 'baklava', dishes: [] },
    ], shops, 'sweet');
    // The café's cake belongs to the café door.
    expect(row.map((r) => r.kind.key)).toEqual(['kunafa']);
  });
  it('a dish already shown under one picture is not repeated under another', () => {
    const row = cravingRow(kinds, [
      { key: 'kunafa', dishes: [dish('k1', 'sweets')] },
      { key: 'cake', dishes: [dish('k1', 'sweets')] },
    ], shops, 'sweet');
    expect(row).toHaveLength(1);
  });
  it('the three best for a craving carry their dish', () => {
    const open = [shop('a', ['sweets'], { rating: 4.9 }), shop('b', ['sweets'], { rating: 4.1, etaMaxMinutes: 10 }), shop('c', ['sweets'])];
    const picks = cravingPicks({ kind: kinds[0]!, dishes: [dish('d1', 'a'), dish('d2', 'b')] }, open);
    expect(picks.map((p) => [p.shop.id, p.reason, p.dish.id])).toEqual([
      ['a', 'rated', 'd1'],
      ['b', 'fastest', 'd2'],
    ]);
  });
});

describe('«قهوتك المعتادة» (q1)', () => {
  const shops = [shop('cafe', ['coffee']), shop('grill', ['grill'])];
  const row = (id: string, merchant: string, state: string, day: number, by = 'me') => ({ id, order: { ordererId: by, merchantOrgId: merchant, state, placedAt: new Date(2026, 9, day) } });
  it('the last delivered café order of mine', () => {
    const history = [row('o1', 'cafe', 'delivered', 1), row('o2', 'cafe', 'completed', 3), row('o3', 'grill', 'delivered', 4), row('o4', 'cafe', 'cancelled', 5), row('o5', 'cafe', 'delivered', 6, 'friend')];
    expect(usualOrder(history, shops, 'cafe', 'me')?.id).toBe('o2');
    expect(usualOrder(history, shops, 'cafe', null)).toBeNull();
  });
});

describe('this hour (d7)', () => {
  it('tea and cake in the afternoon, ice cream on a summer night', () => {
    expect(hourWords(at(16))).toContain('كيك');
    expect(hourWords(at(22, 6))).toContain('آيس كريم');
  });
});
