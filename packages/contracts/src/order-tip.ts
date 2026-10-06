import { z } from 'zod';
import { Iqd } from './common.js';
import { AZIZIYAH_MONEY_RULES, type MoneyRules } from './ledger-rules.js';
import { OrderIdInput } from './order.js';

/**
 * «تحب تكرم عباس؟» — the tip after a good rating (Ali, 2026-10-06: "do whatever is best"). Cash-first
 * market, so the in-app tip only moves wallet money: after the customer rates the courier/driver 4–5
 * stars he may give 500 / 1,000 / 2,000 دينار from his own wallet balance, 100 % to the driver, once
 * per order, within `windowHours` of delivery. When his wallet can't cover a chip, the app shows no
 * wallet chips and says a cash tip can be handed over directly. Rules are city config
 * (`MoneyRules.afterTip`), checked only on the server; docs/api/tips.md.
 */

/** Memo on the tip line, so the wallet, receipts and finance tell it apart from a checkout tip. */
export const AFTER_TIP_MEMO = 'after_rating';

/** Posting group of an order's tip after the rating: one per order, so a replay posts nothing. */
export const afterTipGroupId = (orderId: string): string => `tip:${orderId}`;

/** Why the app shows no tip prompt (null when it does). */
export const TipOfferReason = z.enum(['not_rated', 'low_rating', 'not_delivered', 'window_closed', 'tipped_at_checkout', 'no_driver']);
export type TipOfferReason = z.infer<typeof TipOfferReason>;

export const TipOffer = z.object({
  orderId: z.string(),
  /** The prompt shows (rated ≥ `minRating`, delivered, within the window, a driver carried it). */
  offered: z.boolean(),
  reason: TipOfferReason.nullable(),
  /** The chips his wallet covers right now, low to high; empty → the cash note instead. */
  amountsIqd: z.array(Iqd.positive()),
  /** What his own wallet can spend (balance less his open wallet orders). */
  walletIqd: z.number().int(),
  /** Last moment the tip can be given; null when not offered. */
  untilAt: z.coerce.date().nullable(),
  /** The tip he already gave on this order (the prompt then thanks him instead). */
  tip: z.object({ amountIqd: Iqd.positive(), at: z.coerce.date() }).nullable(),
});
export type TipOffer = z.infer<typeof TipOffer>;

export const TipOrderInput = OrderIdInput.extend({ amountIqd: Iqd.positive() });
export type TipOrderInput = z.infer<typeof TipOrderInput>;

export const TipResult = z.object({
  orderId: z.string(),
  amountIqd: Iqd.positive(),
  at: z.coerce.date(),
  /** His wallet after the tip. */
  walletIqd: z.number().int(),
});
export type TipResult = z.infer<typeof TipResult>;

/** The window and chips in force (config, never literals in the apps). */
export function afterTipRules(rules: Pick<MoneyRules, 'afterTip'> = AZIZIYAH_MONEY_RULES): MoneyRules['afterTip'] {
  return rules.afterTip;
}
