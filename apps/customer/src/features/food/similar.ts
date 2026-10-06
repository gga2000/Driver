import { similarKitchens, type RestaurantCard } from '@driver/contracts';

/**
 * The rejection fallback's suggestions (spec §3): open kitchens other than the one that said no,
 * most shared cuisine tags first, then the quickest to the door, then the best rated. Two by default.
 * The shared rule (`similarKitchens`) is the one the API's carry-over preview uses (joy o15).
 */
export function similarOpenRestaurants(rejected: Pick<RestaurantCard, 'id' | 'tags'>, cards: readonly RestaurantCard[], count = 2): RestaurantCard[] {
  return similarKitchens(rejected, cards, count);
}
