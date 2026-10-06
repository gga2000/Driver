import { AZIZIYAH_MONEY_RULES, type MoneyRules } from './ledger-rules.js';

/**
 * J-D6 (Ali, 2026-10-05; UI/UX audit F-05): an order below a restaurant's minimum is no longer
 * refused. It goes ahead with a fixed small-order fee from the city's money rules (500 دينار in
 * Aziziyah), shown on the restaurant facts and as its own named price line with its reason. The
 * threshold is the restaurant's own `minOrderIqd` (items at menu prices, before any deal); a
 * restaurant without a minimum never charges it. The API decides (`orders.quote` / `orders.place`)
 * and the ledger books it as platform revenue (`service_fee`, memo `small_order`).
 */
export const SMALL_ORDER_FEE_IQD = AZIZIYAH_MONEY_RULES.smallOrder.feeIqd;

/** The small-order fee for a basket: the city fee when 0 < items < the restaurant minimum, else 0. */
export function smallOrderFeeIqd(itemsTotalIqd: number, minOrderIqd: number, rules: Pick<MoneyRules, 'smallOrder'> = AZIZIYAH_MONEY_RULES): number {
  return minOrderIqd > 0 && itemsTotalIqd > 0 && itemsTotalIqd < minOrderIqd ? rules.smallOrder.feeIqd : 0;
}
