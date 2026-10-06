import type { MessageKey } from '@driver/i18n';

/**
 * «عزيمة» on the job card (joy g1): the order is a gift from someone else. At the door with hidden
 * prices the courier must not say the price (the sender paid in the app, so there is nothing to
 * collect); at the kitchen he asks for the receipt to stay out of the bag. A plain gift just says
 * «هدية». Null when it isn't a gift.
 */
export type GiftNote = { key: MessageKey; hint: MessageKey | null; hidden: boolean };

export function giftNote(stop: { type: string; gift?: { hidePrices: boolean } | null }): GiftNote | null {
  const gift = stop.gift;
  if (!gift) return null;
  if (stop.type === 'pickup') return gift.hidePrices ? { key: 'partner.gift_pickup_hidden', hint: null, hidden: true } : null;
  if (stop.type !== 'dropoff') return null;
  return gift.hidePrices ? { key: 'partner.gift_hidden', hint: 'partner.gift_hidden_hint', hidden: true } : { key: 'partner.gift', hint: null, hidden: false };
}
