import type { ErrorCode, OrderGift, OrderType, ParticipantRole, PaymentMethod } from '@driver/contracts';

/** Orders a courier brings to someone's door from a kitchen or shop: the ones that can be a gift. */
const GIFTABLE: ReadonlySet<OrderType> = new Set(['food', 'grocery_catalog']);

/**
 * «عزيمة» (joy g1): why a gift order can't be placed, or null. A gift is a food/grocery order that
 * someone else receives (a `recipient` participant). Hiding the prices is only for a gift the sender
 * paid from his wallet: with cash at the door, the person receiving it has to hear the amount. No new
 * payment way: the two that exist (cash by whoever receives it, the orderer's wallet) are unchanged.
 */
export function giftProblem(input: { gift: OrderGift | undefined; type: OrderType; paymentMethod: PaymentMethod; participantRoles: readonly ParticipantRole[] }): ErrorCode | null {
  const { gift } = input;
  if (!gift) return null;
  if (!GIFTABLE.has(input.type)) return 'invalid_input';
  if (!input.participantRoles.includes('recipient')) return 'gift_needs_recipient';
  if (gift.hidePrices && input.paymentMethod !== 'wallet') return 'gift_hidden_prices_need_wallet';
  return null;
}

/** The order's gift as the apps see it (null for an ordinary order). */
export function giftView(order: { gift?: boolean | undefined; giftHidePrices?: boolean | undefined }): { hidePrices: boolean } | null {
  return order.gift ? { hidePrices: Boolean(order.giftHidePrices) } : null;
}
