import { router } from 'expo-router';
import type { DeliveryPoint, OrderLineInput, PlaceOrderInput } from '@driver/contracts';
import { requireSignIn } from '@/lib/guest';
import { session } from '@/lib/session';
import type { BreadCartState, BasketState } from './basket';
import type { Bakery, Stall } from './model';
import { priceForWeight } from './weight';

export type ShopOrderFrom = 'stall' | 'bakery';

/** Opens the shopping checkout, or asks for the phone first and comes back to it (guest browsing, C-18). */
export async function goCheckout(from: ShopOrderFrom): Promise<void> {
  const href = `/shopping/checkout?from=${from}`;
  if (session.getSnapshot().status !== 'signedIn') return requireSignIn(href);
  router.push({ pathname: '/shopping/checkout', params: { from } });
}

/**
 * The basket as order lines: a kilo item is one line with its grams (`weightG`) and the price the
 * customer saw for that weight; a piece item counts pieces. The server re-prices every line from the
 * stall's posted price and refuses a different one (`price_changed`).
 */
export function stallLines(basket: BasketState, stall: Stall): OrderLineInput[] {
  return basket.lines.flatMap((l): OrderLineInput[] => {
    const item = stall.items.find((i) => i.id === l.itemId);
    if (!item || !item.available) return [];
    const note = l.note.trim() ? { note: l.note.trim() } : {};
    return item.soldBy === 'kg'
      ? [
          {
            catalogItemId: item.id,
            qty: 1,
            weightG: l.amount,
            unitPriceIqd: priceForWeight(item.priceIqd, l.amount),
            ...note,
          },
        ]
      : [{ catalogItemId: item.id, qty: l.amount, unitPriceIqd: item.priceIqd, ...note }];
  });
}

/** Hot bread as order lines: packs of each bread at the bakery's lot price. */
export function bakeryLines(cart: BreadCartState, bakery: Bakery): OrderLineInput[] {
  return Object.entries(cart.packs).flatMap(([itemId, packs]): OrderLineInput[] => {
    const item = bakery.items.find((i) => i.id === itemId);
    return item && item.available && packs > 0
      ? [{ catalogItemId: item.id, qty: packs, unitPriceIqd: item.priceIqd }]
      : [];
  });
}

/** A shop order: a `grocery_catalog` delivery from the stall or bakery, cash at the door. */
export function shopOrderInput(input: {
  cityId: string;
  merchantOrgId: string;
  lines: OrderLineInput[];
  dropoff: DeliveryPoint;
  courierNote?: string;
}): PlaceOrderInput {
  return {
    cityId: input.cityId,
    type: 'grocery_catalog',
    merchantOrgId: input.merchantOrgId,
    lines: input.lines as PlaceOrderInput['lines'],
    participants: [],
    tipIqd: 0,
    paymentMethod: 'cash',
    dropoff: input.dropoff,
    ...(input.courierNote?.trim() ? { courierNote: input.courierNote.trim() } : {}),
  } as PlaceOrderInput;
}
