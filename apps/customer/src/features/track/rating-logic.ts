import { courierReasonsFor, type CourierRatingReason, type DisputeKind, type OrderType, type RatingTag, type TipOffer } from '@driver/contracts';

/**
 * The rating as plain data. Step 1 rates the courier/driver himself (before-launch §6): under his
 * stars, optional one-tap reasons — what went wrong, only for 1–3 — that go with his
 * own rating. Low-rating recovery (audit C-12): 1–3 on either score offers to open a complaint on
 * the spot (a low food score first asks what was wrong with the food, stored as rating tags);
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

/** The courier's own reasons under his score (the server takes exactly these). */
export function courierReasons(score: number, type: OrderType): CourierRatingReason[] {
  if (score <= 0) return [];
  return courierReasonsFor(score, type === 'ride');
}

/** The food's reasons on the recovery step: only a kitchen order whose food got 1–3 (the courier's are on step 1). */
export function lowReasons(type: OrderType, food: number | null): readonly RatingTag[] {
  if (type === 'ride' || food === null || food <= 0 || food > LOW_SCORE) return [];
  return ['cold', 'missing_item'];
}

/** The complaint a set of reasons opens: missing first (it has a refund path), then cold or a late courier, else other. */
export function disputeKindFor(tags: readonly RatingTag[], type: OrderType, courier: readonly CourierRatingReason[] = []): DisputeKind {
  if (type === 'ride') return 'other';
  if (tags.includes('missing_item')) return 'missing_item';
  if (tags.includes('cold') || tags.includes('late') || courier.includes('late')) return 'cold_or_late';
  return 'other';
}

/** Drops the reasons that no longer fit after the stars changed (a 2 turned into a 5 keeps none of the low ones). */
export function keepFitting(picked: readonly CourierRatingReason[], score: number, type: OrderType): CourierRatingReason[] {
  const offered = courierReasons(score, type);
  return picked.filter((r) => offered.includes(r));
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
