import { AZIZIYAH_MONEY_RULES } from './ledger-rules.js';

/**
 * Points at checkout (UI/UX audit W-02, J-D10 — Ali, 2026-10-05). 100 points = 1,000 دينار; points
 * pay the delivery fee first (after a free-delivery deal), then the service fee — never the dishes,
 * the small-order fee or the tip. One rule for the API (what `orders.quote` / `orders.place` apply)
 * and the ledger (`redemption()` when a closed order posts), so both always agree. Until
 * 2026-10-05 the decisions doc said "service fee first".
 */
export const POINT_VALUE_IQD = AZIZIYAH_MONEY_RULES.points.pointValueIqd;

export interface PointsRedemption {
  /** Points actually used (whole points, at most what the fees can take). */
  points: number;
  againstDelivery: number;
  againstService: number;
  valueIqd: number;
}

/** What `points` buy against an order's fees: the delivery fee first, then the service fee. */
export function pointsRedemption(points: number, fees: { serviceFeeIqd: number; deliveryFeeIqd: number }, pointValueIqd: number = POINT_VALUE_IQD): PointsRedemption {
  const delivery = Math.max(0, fees.deliveryFeeIqd);
  const service = Math.max(0, fees.serviceFeeIqd);
  const usable = Math.max(0, Math.min(Math.floor(points), Math.floor((delivery + service) / pointValueIqd)));
  const valueIqd = usable * pointValueIqd;
  const againstDelivery = Math.min(valueIqd, delivery);
  return { points: usable, againstDelivery, againstService: valueIqd - againstDelivery, valueIqd };
}

/**
 * How many of the customer's points an order can take: his available points, capped by its fees
 * (`pointsRedemption`) and by what is left of its price after any discount, so a total never goes
 * below zero.
 */
export function redeemablePoints(
  o: { availablePoints: number; serviceFeeIqd: number; deliveryFeeIqd: number; priceIqd: number },
  pointValueIqd: number = POINT_VALUE_IQD,
): number {
  const byPrice = Math.floor(Math.max(0, o.priceIqd) / pointValueIqd);
  return pointsRedemption(Math.min(Math.max(0, o.availablePoints), byPrice), o, pointValueIqd).points;
}
