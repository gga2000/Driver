import type { DisputeKind, OrderType, RatingTag, TipOffer } from '@driver/contracts';

/**
 * Low-rating recovery (audit C-12) as plain data. After the stars: 1–3 on either score asks what
 * went wrong (one-tap reasons stored as rating tags) and offers to open a complaint on the spot;
 * 4–5 thanks, then asks «تحب تكرم عباس؟» (Ali, 2026-10-06): the tip after a good rating, from the
 * wallet, every rule on the server (`orders.tipOptions` / `orders.tip`, docs/api/tips.md).
 */

/** At or below this, the rating asks what went wrong. */
export const LOW_SCORE = 3;

export type RatingBranch = 'recover' | 'thanks';

/** The lowest score given decides: a 5 for the courier does not hide a 2 for the food. */
export function ratingBranch(delivery: number, food: number | null): RatingBranch {
  const scores = [delivery, food].filter((s): s is number => typeof s === 'number' && s > 0);
  return scores.length > 0 && Math.min(...scores) <= LOW_SCORE ? 'recover' : 'thanks';
}

/** The reasons offered: food orders get the kitchen and courier problems, rides the driver ones. */
export function lowReasons(type: OrderType): readonly RatingTag[] {
  if (type === 'ride') return ['late', 'rude'];
  return ['cold', 'missing_item', 'late', 'rude'];
}

/** The complaint a set of reasons opens: missing first (it has a refund path), then cold/late, else other. */
export function disputeKindFor(tags: readonly RatingTag[], type: OrderType): DisputeKind {
  if (type === 'ride') return 'other';
  if (tags.includes('missing_item')) return 'missing_item';
  if (tags.includes('cold') || tags.includes('late')) return 'cold_or_late';
  return 'other';
}

/**
 * What the tip card shows after a good rating, from the server's offer:
 *   hidden     not offered (below 4 stars, a checkout tip, too late, no driver), or he said «لا شكراً»
 *   chips      the amounts his wallet covers, and «لا شكراً»
 *   cash_note  offered but his wallet covers none: a gentle line that cash can be handed over
 *   thanks     he already tipped on this order
 */
export type TipCard = 'hidden' | 'chips' | 'cash_note' | 'thanks';

export function tipCard(offer: Pick<TipOffer, 'offered' | 'amountsIqd' | 'tip'> | null | undefined, dismissed = false): TipCard {
  if (!offer) return 'hidden';
  if (offer.tip) return 'thanks';
  if (!offer.offered || dismissed) return 'hidden';
  return offer.amountsIqd.length > 0 ? 'chips' : 'cash_note';
}
