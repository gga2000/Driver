import type { DealBadge, DealType, OrderType } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';

/**
 * Where an order's discount may come from (M2 review follow-up): a promotion the server resolved and
 * validated, never a number the client sent. Orders asks at quote and at placement and stores the
 * answer (`orders.discount_iqd`, `orders.promotion_id`, `orders.discount_meta`).
 *
 * Two sources:
 *  - **merchant deals** (domain §11 self-serve deals, funder = merchant): auto-applied, the best one
 *    for the basket; its spend is reserved in the order's unit of work against the budget cap
 *    (`reserve`, atomic) and given back when the order is cancelled (`release`). The ledger books it
 *    as `promo_funded` from the merchant's cash account; item deals lower the commission base (G-87);
 *  - **platform codes** (`resolve`, money §5 launch package): none resolve yet; the ledger funds them
 *    from the promotion's budget line (`platformPromo`).
 * Stacking: one discount per order — the larger of the merchant deal and a resolved code — plus
 * points redemption on the ledger side.
 *
 * Bound to `MerchantDealsPromotions` (promotions module) by the orders module; `NoPromotions` is the
 * null object for harnesses that need no deals. Rides, errands and parcels never take a promotion.
 */
export interface PromotionQuery {
  customerId: string;
  cityId: string;
  orderType: OrderType;
  code: string;
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
  serviceFeeIqd: number;
  at: Date;
}

export interface ResolvedPromotion {
  promotionId: string;
  /** What the platform funds on this order, IQD ≥ 0 (never more than the order's fees + items). */
  discountIqd: number;
}

/** A priced basket as the deal engine sees it (lines in the order's line order). */
export interface MerchantDealQuery {
  merchantOrgId: string;
  lines: ReadonlyArray<{ catalogItemId: string | null; qty: number; unitPriceIqd: number; lineIqd: number }>;
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
  at: Date;
}

export interface MerchantDealResult {
  promotionId: string;
  type: DealType;
  /** items: off the dishes; delivery: free delivery (the courier still earns the full fee). */
  target: 'items' | 'delivery';
  /** Before the order total is rounded (orders rounds and may lower it, never raise it). */
  discountIqd: number;
  lineSavingsIqd: number[];
  label_ar: string;
  label_en: string;
}

export interface PromotionsPort {
  /** The promotion `code` grants this customer on this order, or null when none applies. */
  resolve(query: PromotionQuery): Promise<ResolvedPromotion | null>;
  /** The merchant's best live deal for this basket, or null. */
  merchantDeal(query: MerchantDealQuery): Promise<MerchantDealResult | null>;
  /** The same deal re-evaluated on a changed basket (partial accept), schedule and budget aside. */
  reapplyMerchantDeal(promotionId: string, query: MerchantDealQuery): Promise<MerchantDealResult | null>;
  /** The live deal with the smallest unmet minimum, for the cart nudge. */
  nextMerchantDeal(query: MerchantDealQuery): Promise<{ promotionId: string; label_ar: string; label_en: string; missingIqd: number } | null>;
  /** Live deals with budget left, as storefront badges. */
  badges(merchantOrgId: string, at: Date): Promise<DealBadge[]>;
  /** Atomic check-and-increment of the deal's spend in `tx`; false when the budget cap would be passed. */
  reserve(promotionId: string, amountIqd: number, tx: Tx): Promise<boolean>;
  /** Gives spend back (order cancelled / reduced). */
  release(promotionId: string, amountIqd: number, tx: Tx): Promise<void>;
}

export const ORDERS_PROMOTIONS = Symbol('ORDERS_PROMOTIONS');

/** The null object: no code and no deal ever resolves. */
export class NoPromotions implements PromotionsPort {
  async resolve(): Promise<ResolvedPromotion | null> {
    return null;
  }

  async merchantDeal(): Promise<MerchantDealResult | null> {
    return null;
  }

  async reapplyMerchantDeal(): Promise<MerchantDealResult | null> {
    return null;
  }

  async nextMerchantDeal(): Promise<null> {
    return null;
  }

  async badges(): Promise<DealBadge[]> {
    return [];
  }

  async reserve(): Promise<boolean> {
    return false;
  }

  async release(): Promise<void> {}
}
