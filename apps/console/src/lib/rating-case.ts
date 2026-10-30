import { INBOX_RULES, type OrderRating } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/** The same line the server draws for a Today case: food or courier at 2 or under. */
export function badRating(r: Pick<OrderRating, 'food' | 'delivery'>): boolean {
  const max = INBOX_RULES.lowRatingMaxStars;
  return (r.food !== null && r.food <= max) || (r.delivery !== null && r.delivery <= max);
}

const TAG_KEY: Partial<Record<string, MessageKey>> = {
  cold: 'rating.tag.cold',
  missing_item: 'rating.tag.missing_item',
  late: 'rating.tag.late',
  rude: 'rating.tag.rude',
};
const COURIER_KEY: Partial<Record<string, MessageKey>> = {
  late: 'rating.courier.late',
  rude: 'rating.courier.rude',
  mishandled: 'rating.courier.mishandled',
  hard_to_reach: 'rating.courier.hard_to_reach',
  unsafe_driving: 'rating.courier.unsafe_driving',
};

/**
 * What the customer tapped, in the words he saw: the order tags that complain (praise tags are
 * left out), then the reasons under the courier score, each said once.
 */
export function ratingReasons(r: Pick<OrderRating, 'tags' | 'courierReasons'>, ride: boolean): MessageKey[] {
  const keys: MessageKey[] = [];
  for (const tag of r.tags) {
    const k = tag === 'rude' && ride ? ('rating.tag.rude_ride' as MessageKey) : TAG_KEY[tag];
    if (k) keys.push(k);
  }
  for (const reason of r.courierReasons ?? []) {
    // "تأخر" and "ما كان لطيف" can be tapped twice (order tag and courier reason): say them once.
    if (reason === 'late' && r.tags.includes('late')) continue;
    if (reason === 'rude' && r.tags.includes('rude')) continue;
    const k = COURIER_KEY[reason];
    if (k) keys.push(k);
  }
  return keys;
}
