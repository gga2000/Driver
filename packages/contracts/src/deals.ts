import { z } from 'zod';
import { t, type Locale } from '@driver/i18n';
import { Iqd } from './common.js';

/**
 * Merchant deals as the customer sees them (domain §11, merchant self-serve deals): the badge on a
 * restaurant card and menu, and the discount line a server quote carries. Deals are evaluated and
 * locked by the API (`orders.quote` / `orders.place`); the client never sends a discount of its own.
 *
 * Stacking (adopted 2026-10-04): at most ONE merchant deal per order — the one that saves the
 * customer the most — plus points redemption (delivery fee first, then the service fee — J-D10, `pointsRedemption`). Platform promo codes come
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
  /** What the order really takes off (the funder's cost). Since 2026-10-04 exactly the deal as promised. */
  amountIqd: Iqd.min(0),
  /**
   * The deal's exact saving as promised (20 % of 15,000 = 3,000), before the total is rounded. The
   * cart, checkout and receipts show this on the deal line; absent on orders placed before
   * 2026-10-04 (show `amountIqd`).
   */
  dealIqd: Iqd.min(0).optional(),
  /**
   * Legacy (orders placed before 2026-10-04, when the deal was lowered so the total landed on 500):
   * `dealIqd − amountIqd`, shown as a small "تقريب" line. 0 on newer orders — the deal applies exactly
   * and cash rounding is change to the wallet instead (`Order.changeIqd`).
   */
  roundingIqd: Iqd.min(0).optional(),
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

/**
 * A percent deal's saving on a line (qty × (menu price + modifiers)), floored to the dinar: the one
 * rule the API's deal engine applies at checkout and the menu shows (f10).
 */
export function percentDealSaving(lineIqd: number, percent: number): number {
  return Math.floor((lineIqd * percent) / 100);
}

/** A dish's deal price on the menu (f10): which deal, its percent, and one plain unit's price under it. */
export interface MenuDealPrice {
  dealId: string;
  percent: number;
  priceIqd: number;
}

/**
 * The deal price a dish shows on the menu (UI/UX audit F-02): a live percent deal with no minimum
 * that covers the dish applies to it in any cart, so its price under the deal is certain. Deals with
 * a minimum, fixed amounts, BOGO and free delivery depend on the whole cart and stay in the cart's
 * own lines. The largest percent wins; the first listed on a tie.
 */
export function menuDealOf(item: { id: string; priceIqd: number }, deals: ReadonlyArray<Pick<DealBadge, 'dealId' | 'type' | 'value' | 'minOrderIqd' | 'itemIds'>>): MenuDealPrice | null {
  if (item.priceIqd <= 0) return null;
  let best: MenuDealPrice | null = null;
  for (const d of deals) {
    if (d.type !== 'percent' || d.minOrderIqd > 0 || d.value <= 0) continue;
    if (d.itemIds.length > 0 && !d.itemIds.includes(item.id)) continue;
    if (best && d.value <= best.percent) continue;
    best = { dealId: d.dealId, percent: d.value, priceIqd: item.priceIqd - percentDealSaving(item.priceIqd, d.value) };
  }
  return best;
}

/** A line's price under the dish's menu deal (the item sheet's add button); the plain price without one. */
export function dealLinePrice(lineIqd: number, deal: Pick<MenuDealPrice, 'percent'> | null | undefined): number {
  return deal ? lineIqd - percentDealSaving(lineIqd, deal.percent) : lineIqd;
}
