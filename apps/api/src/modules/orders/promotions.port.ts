import type { OrderType } from '@driver/contracts';

/**
 * Where an order's discount may come from (M2 review follow-up): a promotion the server resolved and
 * validated, never a number the client sent. Narrow on purpose — orders asks one question at
 * placement and stores the answer (`orders.discount_iqd`, `orders.promotion_id`); the ledger funds it
 * from the promotion's budget line (`platformPromo` on the money fact).
 *
 * Only implementation today: `NoPromotions` — nothing resolves, so every order's discount is 0 and a
 * promo code is refused with `promotion_invalid`. The promotions module (money §5: launch package,
 * budgets with auto-stop caps, one first-order offer per device + phone + place, single-use codes)
 * binds a real implementation to `ORDERS_PROMOTIONS` when it ships; orders does not change.
 * Rides, errands and parcels never take a promotion yet: their money facts have no promo line.
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

export interface PromotionsPort {
  /** The promotion `code` grants this customer on this order, or null when none applies. */
  resolve(query: PromotionQuery): Promise<ResolvedPromotion | null>;
}

export const ORDERS_PROMOTIONS = Symbol('ORDERS_PROMOTIONS');

/** The binding until the promotions module exists: no promotion ever resolves. */
export class NoPromotions implements PromotionsPort {
  async resolve(): Promise<ResolvedPromotion | null> {
    return null;
  }
}
