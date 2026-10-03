import type { RestaurantCard } from '@driver/contracts';

/**
 * The rejection fallback's suggestions (spec §3): open kitchens other than the one that said no,
 * most shared cuisine tags first, then the quickest to the door, then the best rated. Two by default.
 */
export function similarOpenRestaurants(rejected: Pick<RestaurantCard, 'id' | 'tags'>, cards: readonly RestaurantCard[], count = 2): RestaurantCard[] {
  const want = new Set(rejected.tags);
  const shared = (c: RestaurantCard) => c.tags.filter((t) => want.has(t)).length;
  return cards
    .filter((c) => c.id !== rejected.id && c.open && c.pickup !== null)
    .sort((a, b) => shared(b) - shared(a) || (a.etaMinMinutes ?? a.prepMinMinutes) - (b.etaMinMinutes ?? b.prepMinMinutes) || (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0))
    .slice(0, count);
}
