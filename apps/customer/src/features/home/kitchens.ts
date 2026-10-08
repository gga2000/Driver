import type { RestaurantSummary } from './restaurant-summary';

/** Kitchens listed on home before «كل المحلات» (concept C: a short list; the gallery above already shows their food). */
export const HOME_KITCHENS = 3;

/**
 * The delivery fee every open kitchen charges to this place, so home says it once over the list
 * («التوصيل 500 دينار لكل المحلات») instead of on every row. Null when they differ, or before a place
 * is picked: then each row says its own.
 */
export function sharedFee(kitchens: readonly Pick<RestaurantSummary, 'deliveryFeeIqd'>[]): number | null {
  const first = kitchens[0]?.deliveryFeeIqd ?? null;
  if (first === null) return null;
  return kitchens.every((k) => k.deliveryFeeIqd === first) ? first : null;
}
