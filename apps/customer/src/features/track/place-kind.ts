import type { MessageKey } from '@driver/i18n';

/**
 * Who the order is with, for the words on the tracking screen (2026-10-11): a restaurant (food), a
 * shop (a stall or bakery: `grocery_catalog`) or a shopper buying for you (دوّرلي: `errand`). Read only
 * from the order's type as the server sends it, never guessed from a name. Restaurant words stay as
 * they were; a shop or دوّرلي swaps in its own key where one exists.
 */
export type PlaceKind = 'restaurant' | 'shop' | 'shopForMe';

export function placeKind(order: { type: string }): PlaceKind {
  if (order.type === 'grocery_catalog') return 'shop';
  if (order.type === 'errand') return 'shopForMe';
  return 'restaurant';
}

const SHOP: Partial<Record<MessageKey, MessageKey>> = {
  'order.status.placed': 'order.status.placed_shop',
  'order.status.placed_hint': 'order.status.placed_hint_shop',
  'order.status.awaiting_payer_hint': 'order.status.awaiting_payer_hint_shop',
  'order.status.merchant_accepted': 'order.status.merchant_accepted_shop',
  'order.status.preparing': 'order.status.preparing_shop',
  'order.status.merchant_rejected': 'order.status.merchant_rejected_shop',
  'order.status.merchant_rejected_hint': 'order.status.merchant_rejected_hint_shop',
  'track.courier_to_kitchen_short': 'track.courier_to_kitchen_short_shop',
  'track.note_courier_to_kitchen': 'track.note_courier_to_kitchen_shop',
  'track.note_courier_waiting': 'track.note_courier_waiting_shop',
  'track.kitchen_pin': 'track.kitchen_pin_shop',
  'track.message_merchant': 'track.message_merchant_shop',
  'kitchen.step_sent': 'kitchen.step_sent_shop',
  'kitchen.step_confirm': 'kitchen.step_confirm_shop',
  'kitchen.step_cooking': 'kitchen.step_cooking_shop',
  'kitchen.cancel_free': 'kitchen.cancel_free_shop',
  'kitchen.slow_hint': 'kitchen.slow_hint_shop',
};

const SHOP_FOR_ME: Partial<Record<MessageKey, MessageKey>> = {
  'order.status.placed': 'order.status.placed_errand',
  'order.status.placed_hint': 'order.status.placed_hint_errand',
  'track.courier_to_kitchen_short': 'track.courier_to_kitchen_short_errand',
  'track.note_courier_to_kitchen': 'track.note_courier_to_kitchen_errand',
  'track.note_courier_waiting': 'track.note_courier_waiting_errand',
  'track.kitchen_pin': 'track.kitchen_pin_shop',
};

/** `key` in the words of this kind of place (the restaurant key itself when there is no other). */
export function placeWord(key: MessageKey, kind: PlaceKind): MessageKey {
  if (kind === 'shop') return SHOP[key] ?? key;
  if (kind === 'shopForMe') return SHOP_FOR_ME[key] ?? key;
  return key;
}
