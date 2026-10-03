import {
  AZIZIYAH_MONEY_RULES,
  deliveryFeesOf,
  type DeliveryPoint,
  type Order,
  type ParticipantInput,
  type PlaceOrderInput,
  type PriceRequestInput,
  type Quote,
  type QuoteComponent,
} from '@driver/contracts';
import { ME, itemsTotal, type CartState } from './cart';

/**
 * Checkout as plain data: the delivery quote request, the totals the cart and checkout show, and
 * the exact `orders.place` payload. The cart, checkout and server all price from the same numbers:
 * menu prices on lines, the fee split of `deliveryFeesOf`, sent as expectations the server checks
 * (`price_changed`), so the total never changes between the cart and the order.
 */

export type Recipient = { kind: 'me' } | { kind: 'person'; personId: string } | { kind: 'other'; name: string; phone: string };

/** The food quote from the kitchen to the deliver-to point (door unless street hand-over). */
export function cartQuoteRequest(input: { cityId: string; pickup: DeliveryPoint; dropoff: DeliveryPoint; streetHandover: boolean; at: Date }): PriceRequestInput {
  const stop = (p: DeliveryPoint, type: 'pickup' | 'dropoff') => ({ zoneId: p.zoneKey, type, ...(p.pin ? { pin: p.pin } : {}) });
  return {
    cityId: input.cityId,
    vertical: 'food',
    stops: [stop(input.pickup, 'pickup'), stop(input.dropoff, 'dropoff')],
    options: { streetHandover: input.streetHandover, doorPickup: false },
    at: input.at,
  };
}

export interface CheckoutTotals {
  itemsIqd: number;
  deliveryFeeIqd: number;
  serviceFeeIqd: number;
  totalIqd: number;
  /** Delivery's named parts (base, door/street, night…) for the breakdown, service fee last. */
  components: QuoteComponent[];
}

export function checkoutTotals(cart: Pick<CartState, 'lines'>, quote: Pick<Quote, 'components'>): CheckoutTotals {
  const items = itemsTotal(cart);
  const fees = deliveryFeesOf(quote);
  const parts = quote.components.filter((c) => c.key !== 'promo');
  const components = [...parts.filter((c) => c.key !== 'service_fee'), ...parts.filter((c) => c.key === 'service_fee')];
  return { itemsIqd: items, ...fees, totalIqd: items + fees.deliveryFeeIqd + fees.serviceFeeIqd, components };
}

export interface CheckoutChoices {
  cart: CartState;
  dropoff: DeliveryPoint;
  streetHandover: boolean;
  recipient: Recipient;
  scheduledFor: Date | null;
  paymentMethod: 'cash' | 'wallet';
  fees: { deliveryFeeIqd: number; serviceFeeIqd: number };
  note?: string;
}

const OTHER_RECIPIENT_REF = 'recipient';

/**
 * The `orders.place` input: catalog ids with the menu prices the person saw, one participant per
 * person on the order (diner; the recipient when they receive it), lines tagged by `participantRef`
 * with their own notes, the drop-off, and the fees as expectations.
 */
export function buildPlaceOrderInput(c: CheckoutChoices): PlaceOrderInput {
  const merchant = c.cart.merchant;
  if (!merchant) throw new Error('empty cart');
  const used = new Set(c.cart.lines.map((l) => l.personId));
  const participants: ParticipantInput[] = c.cart.people
    .filter((p) => used.has(p.id))
    .map((p) => ({
      ref: p.id,
      role: c.recipient.kind === 'person' && c.recipient.personId === p.id ? 'recipient' : 'diner',
      label: p.name.slice(0, 40),
      ...(p.phone ? { phone: p.phone } : {}),
    }));
  if (c.recipient.kind === 'other') {
    participants.push({ ref: OTHER_RECIPIENT_REF, role: 'recipient', label: c.recipient.name.trim().slice(0, 40), phone: c.recipient.phone });
  }
  return {
    cityId: merchant.cityId,
    type: 'food',
    merchantOrgId: merchant.id,
    lines: c.cart.lines.map((l) => ({
      catalogItemId: l.itemId,
      qty: l.qty,
      unitPriceIqd: l.basePriceIqd,
      modifiers: l.modifiers.map((m) => ({ groupId: m.groupId, modifierId: m.modifierId, priceIqd: m.priceIqd })),
      ...(l.personId !== ME ? { participantRef: l.personId } : {}),
      ...(l.note ? { note: l.note.slice(0, 300) } : {}),
      merchantOrgId: merchant.id,
    })),
    participants,
    deliveryFeeIqd: c.fees.deliveryFeeIqd,
    serviceFeeIqd: c.fees.serviceFeeIqd,
    tipIqd: 0,
    options: { streetHandover: c.streetHandover },
    paymentMethod: c.paymentMethod,
    dropoff: c.dropoff,
    ...(c.scheduledFor ? { scheduledFor: c.scheduledFor } : {}),
    ...(c.note?.trim() ? { note: c.note.trim().slice(0, 500) } : {}),
  };
}

/** Completed cash orders, as the ledger counts them for the new-customer cap. */
export function priorCashOrders(orders: ReadonlyArray<Pick<Order, 'paymentMethod' | 'state'>>): number {
  return orders.filter((o) => o.paymentMethod === 'cash' && (o.state === 'delivered' || o.state === 'closed' || o.state === 'completed')).length;
}

/** Decisions §4: a new account's first cash orders are capped (25,000). Checked again by the server. */
export function overNewCustomerCap(totalIqd: number, prior: number, paymentMethod: 'cash' | 'wallet'): boolean {
  const rule = AZIZIYAH_MONEY_RULES.newCustomerCash;
  return paymentMethod === 'cash' && prior < rule.firstOrders && totalIqd > rule.maxOrderIqd;
}

export const NEW_CUSTOMER_CAP_IQD = AZIZIYAH_MONEY_RULES.newCustomerCash.maxOrderIqd;

/** Next half-hour slots at least `leadMin` from now, for "schedule" (local device time). */
export function scheduleSlots(now: Date, count = 6, leadMin = 45): Date[] {
  const first = new Date(now.getTime() + leadMin * 60_000);
  first.setSeconds(0, 0);
  const m = first.getMinutes();
  first.setMinutes(m === 0 || m === 30 ? m : m < 30 ? 30 : 60);
  return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * 30 * 60_000));
}

/** 12-hour "7:30" for a slot (voice guide §5). */
export function clock12(d: Date): string {
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Errors `orders.place` can answer with that the checkout explains in its own words. */
export type PlaceProblem = 'price_changed' | 'catalog_item_unavailable' | 'modifier_invalid' | 'new_customer_cash_cap' | 'merchant_paused' | 'other';

export function placeProblem(code: string | null): PlaceProblem {
  switch (code) {
    case 'price_changed':
    case 'catalog_item_unavailable':
    case 'modifier_invalid':
    case 'new_customer_cash_cap':
    case 'merchant_paused':
      return code;
    default:
      return 'other';
  }
}
