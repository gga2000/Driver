import type { OrderGift } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * «عزيمة» (joy g1): sending a meal to someone else's door as a gift. Built on o12 («someone else
 * receives it»): the same two ways to pay (they pay cash at the door, or I pay now from my wallet), the
 * same live tracking link. These helpers only choose words and shapes; amounts are the server's.
 */

export interface Copy {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** The longest card message: one line on a phone notification. */
export const CARD_MAX = 80;

/** Card lines one tap away (the sender can still write his own). */
export const CARD_SUGGESTIONS: readonly MessageKey[] = ['gift.card_mum', 'gift.card_dear', 'gift.card_get_well', 'gift.card_deserve'];

/** The card as it travels: one line, trimmed, at most `CARD_MAX` characters; null when empty. */
export function cleanCard(text: string): string | null {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one) return null;
  return [...one].slice(0, CARD_MAX).join('');
}

/** Prices can only be hidden when I pay from my wallet: with cash, the person at the door must hear the amount. */
export function hidePricesAllowed(payment: 'cash' | 'wallet'): boolean {
  return payment === 'wallet';
}

/** What checkout sends as `gift` (undefined = not a gift). Hidden prices fall away with cash. */
export function giftInput(choice: { on: boolean; hidePrices: boolean }, payment: 'cash' | 'wallet'): OrderGift | undefined {
  if (!choice.on) return undefined;
  return { hidePrices: choice.hidePrices && hidePricesAllowed(payment) };
}

/**
 * The heads-up the sender sends from his own WhatsApp (or SMS), with the live tracking link: «عازمك»
 * when he paid, «طلبتلك … تدفعها للدليفري كاش» when the person receiving it pays at the door, and the
 * card line in quotes when he wrote one.
 */
export function giftMessage(input: { merchant: string; card: string | null; url: string; paidByMe: boolean }): Copy {
  const base = input.paidByMe ? 'gift.message_paid' : 'gift.message_cash';
  if (input.card) return { key: `${base}_card` as MessageKey, params: { merchant: input.merchant, card: input.card, url: input.url } };
  return { key: base as MessageKey, params: { merchant: input.merchant, url: input.url } };
}

/** An SMS with the text typed in: iOS separates the body with `&`, Android and the web with `?`. */
export function smsUrl(phone: string, text: string, os: string): string {
  const number = phone.replace(/[^\d+]/g, '');
  return `sms:${number}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
