import type { DealBadge } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { bestDeal, evaluateDeal, nextDeal, type Basket, type DealOutcome, type DealRecord } from '../promotions/index.js';
import type { MerchantDealQuery, MerchantDealResult, PromotionQuery, PromotionsPort, ResolvedPromotion } from './promotions.port.js';

/** What the adapter needs of the promotions module (`PromotionsService`). */
export interface DealSource {
  dealsOf(merchantOrgId: string, tx?: Tx): Promise<DealRecord[]>;
  badges(merchantOrgId: string, at?: Date): Promise<DealBadge[]>;
  reserveSpend(dealId: string, amountIqd: number, tx?: Tx): Promise<boolean>;
  releaseSpend(dealId: string, amountIqd: number, tx?: Tx): Promise<void>;
}

function basketOf(q: MerchantDealQuery): Basket {
  return { lines: q.lines, itemsTotalIqd: q.itemsTotalIqd, deliveryFeeIqd: q.deliveryFeeIqd };
}

function result(o: DealOutcome): MerchantDealResult {
  return { promotionId: o.dealId, type: o.type, target: o.target, discountIqd: o.amountIqd, lineSavingsIqd: o.lineSavingsIqd, label_ar: o.label_ar, label_en: o.label_en };
}

/**
 * The orders module's `PromotionsPort` over the promotions module: merchant deals are evaluated with
 * the pure deal engine (`promotions/deal-pricing.ts`), their spend reserved and released through the
 * promotions repository inside the order's transaction. Platform codes resolve nothing yet.
 */
export class MerchantDealsPromotions implements PromotionsPort {
  constructor(private readonly deals: DealSource) {}

  /** Platform codes (money §5 launch package) are not issued yet: no code resolves. */
  async resolve(_query: PromotionQuery): Promise<ResolvedPromotion | null> {
    return null;
  }

  async merchantDeal(q: MerchantDealQuery): Promise<MerchantDealResult | null> {
    const best = bestDeal(await this.deals.dealsOf(q.merchantOrgId), basketOf(q), q.at);
    return best ? result(best) : null;
  }

  async reapplyMerchantDeal(promotionId: string, q: MerchantDealQuery): Promise<MerchantDealResult | null> {
    const deal = (await this.deals.dealsOf(q.merchantOrgId)).find((d) => d.id === promotionId);
    if (!deal) return null;
    // The order already holds this deal's spend: re-price it without the cap (it can only shrink).
    const o = evaluateDeal({ ...deal, budgetCapIqd: null }, basketOf(q));
    return o ? result(o) : null;
  }

  async nextMerchantDeal(q: MerchantDealQuery): Promise<{ promotionId: string; label_ar: string; label_en: string; missingIqd: number } | null> {
    const deals = await this.deals.dealsOf(q.merchantOrgId);
    const next = nextDeal(deals, basketOf(q), q.at);
    if (!next) return null;
    const badge = (await this.deals.badges(q.merchantOrgId, q.at)).find((b) => b.dealId === next.deal.id);
    return badge ? { promotionId: next.deal.id, label_ar: badge.label_ar, label_en: badge.label_en, missingIqd: next.missingIqd } : null;
  }

  badges(merchantOrgId: string, at: Date): Promise<DealBadge[]> {
    return this.deals.badges(merchantOrgId, at);
  }

  reserve(promotionId: string, amountIqd: number, tx: Tx): Promise<boolean> {
    return this.deals.reserveSpend(promotionId, amountIqd, tx);
  }

  release(promotionId: string, amountIqd: number, tx: Tx): Promise<void> {
    return this.deals.releaseSpend(promotionId, amountIqd, tx);
  }
}
