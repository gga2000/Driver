import { z } from 'zod';
import { t, type Locale } from '@driver/i18n';
import { Iqd } from './common.js';

/**
 * Merchant deals as the customer sees them (domain §11, merchant self-serve deals): the badge on a
 * restaurant card and menu, and the discount line a server quote carries. Deals are evaluated and
 * locked by the API (`orders.quote` / `orders.place`); the client never sends a discount of its own.
 *
 * Stacking (adopted 2026-10-04): at most ONE merchant deal per order — the one that saves the
 * customer the most — plus points redemption (ledger, service fee first). Platform promo codes come
 * later; when one resolves it competes with the merchant deal and the larger wins (no stacking).
 */

export const DealType = z.enum(['percent', 'fixed', 'free_delivery', 'bogo']);
export type DealType = z.infer<typeof DealType>;

/** A live deal on a restaurant card / menu (approved, switched on, in schedule, budget left). */
export const DealBadge = z.object({
  dealId: z.string(),
  type: DealType,
  /** Percent for `percent`, IQD for `fixed`, 0 otherwise. */
  value: z.number().int().min(0),
  minOrderIqd: Iqd.min(0),
  /** Covered dishes; empty = the whole menu. */
  itemIds: z.array(z.string()),
  label_ar: z.string(),
  label_en: z.string(),
  endsAt: z.coerce.date(),
});
export type DealBadge = z.infer<typeof DealBadge>;

/** Who pays for a discount and what it comes off. */
export const DiscountFunder = z.enum(['merchant', 'platform']);
export type DiscountFunder = z.infer<typeof DiscountFunder>;
export const DiscountTarget = z.enum(['items', 'delivery', 'order']);
export type DiscountTarget = z.infer<typeof DiscountTarget>;

/** The discount line of a quote or an order: named, with its funder (domain §11: every discount is its own receipt line). */
export const AppliedDiscount = z.object({
  promotionId: z.string(),
  funder: DiscountFunder,
  /** items: comes off the dishes (merchant deals: lowers the commission base); delivery: free delivery. */
  target: DiscountTarget,
  type: DealType.nullable(),
  label_ar: z.string(),
  label_en: z.string(),
  amountIqd: Iqd.min(0),
});
export type AppliedDiscount = z.infer<typeof AppliedDiscount>;

/** "15,000" — Western digits with thousands commas (voice guide §5). */
function amount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The badge line of a deal, e.g. "خصم 20% على كل المنيو", "توصيل مجاني فوق 15,000 دينار". A minimum
 * order is part of the free-delivery line and a suffix on the others.
 */
export function dealLabel(d: { type: DealType; value: number; minOrderIqd: number; itemIds: readonly string[] }, locale: Locale = 'ar-IQ'): string {
  const scoped = d.itemIds.length > 0;
  if (d.type === 'free_delivery') {
    return d.minOrderIqd > 0 ? t('deal.free_delivery_min', { amount: amount(d.minOrderIqd) }, locale) : t('deal.free_delivery', undefined, locale);
  }
  const base =
    d.type === 'percent'
      ? t(scoped ? 'deal.percent_items' : 'deal.percent_all', { n: d.value }, locale)
      : d.type === 'fixed'
        ? t(scoped ? 'deal.fixed_items' : 'deal.fixed_all', { amount: amount(d.value) }, locale)
        : t(scoped ? 'deal.bogo_items' : 'deal.bogo_all', undefined, locale);
  return d.minOrderIqd > 0 ? t('deal.min_suffix', { label: base, amount: amount(d.minOrderIqd) }, locale) : base;
}
