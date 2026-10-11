import type { RestaurantCard } from '@driver/contracts';

/** A restaurant on the map: its pin (lng, lat), and the card the brief reads from. */
export interface MapShop {
  id: string;
  at: [number, number];
  card: RestaurantCard;
}

/**
 * The restaurants the map can show (those with a pin), in tour order: open kitchens first, the soonest
 * at the door first, then closed ones by when they open. «الجاي» walks this order and goes round.
 */
export function mapShops(cards: readonly RestaurantCard[]): MapShop[] {
  const minutes = (c: RestaurantCard) => c.etaMinMinutes ?? c.prepMinMinutes;
  return cards
    .filter((c) => c.pickup?.pin)
    .sort((a, b) => Number(b.open) - Number(a.open) || (a.open ? minutes(a) - minutes(b) : (a.opensInMin ?? 9999) - (b.opensInMin ?? 9999)))
    .map((c) => ({ id: c.id, at: [c.pickup!.pin!.lng, c.pickup!.pin!.lat], card: c }));
}

/** The next (1) or previous (−1) shop, going round; the first one when nothing is chosen. */
export function tourStep(shops: readonly MapShop[], currentId: string | null, step: 1 | -1): MapShop | null {
  if (!shops.length) return null;
  const i = shops.findIndex((s) => s.id === currentId);
  if (i < 0) return shops[0]!;
  return shops[(i + step + shops.length) % shops.length]!;
}
