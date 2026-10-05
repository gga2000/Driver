import { formatClock } from '@driver/i18n';
import {
  AZIZIYAH_MONEY_RULES,
  cashToHand,
  deliveryFeesOf,
  type AppliedDiscount,
  type OrderQuote,
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
 * menu prices on lines, the fee split of `deliveryFeesOf`, and the merchant deal the server applies
 * (`orders.quote`) — all sent as expectations the server checks (`price_changed`, `deal_changed`),
 * so the total never changes between the cart and the order. The client never computes a discount.
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
  /** The server's deal (or 0): what `orders.quote` says `place` will take off. */
  discountIqd: number;
  discount: AppliedDiscount | null;
  /** The deal's exact saving as promised (the deal line). Since 2026-10-04 equal to `discountIqd`. */
  dealIqd: number;
  /** Legacy "تقريب" (deal trimmed onto a 500 step): always 0 now. */
  roundingIqd: number;
  /** What the order costs: items + fees − the deal. */
  priceIqd: number;
  /**
   * What the customer pays (Ali, 2026-10-04): cash → the price rounded up to 250 (what he hands the
   * courier); wallet → the exact price.
   */
  totalIqd: number;
  /** Cash only: `totalIqd − priceIqd` (0–249), credited to his wallet — the "الباقي رصيد" strip. */
  changeIqd: number;
  /** Delivery's named parts (base, door/street, night…) for the breakdown, service fee last. */
  components: QuoteComponent[];
}

/**
 * Cart and checkout totals: items at menu prices, fees split from the pricing quote, the discount line
 * from the server's order quote (`orders.quote`, merchant deal) — never computed here — and the
 * payment: cash rounds up to 250 with the change to the wallet, the wallet pays the exact price
 * (`cashToHand`, the same helper the server prices with).
 */
export function checkoutTotals(
  cart: Pick<CartState, 'lines'>,
  quote: Pick<Quote, 'components'>,
  order?: Pick<OrderQuote, 'discountIqd' | 'discount'> | null,
  paymentMethod: 'cash' | 'wallet' = 'cash',
): CheckoutTotals {
  const items = itemsTotal(cart);
  const fees = deliveryFeesOf(quote);
  const parts = quote.components.filter((c) => c.key !== 'promo');
  const components = [...parts.filter((c) => c.key !== 'service_fee'), ...parts.filter((c) => c.key === 'service_fee')];
  const discountIqd = order?.discountIqd ?? 0;
  const priceIqd = Math.max(0, items + fees.deliveryFeeIqd + fees.serviceFeeIqd - discountIqd);
  const cash = paymentMethod === 'cash' ? cashToHand(priceIqd) : { cashIqd: priceIqd, changeIqd: 0 };
  return {
    itemsIqd: items,
    ...fees,
    discountIqd,
    discount: order?.discount ?? null,
    dealIqd: discountIqd,
    roundingIqd: 0,
    priceIqd,
    totalIqd: cash.cashIqd,
    changeIqd: cash.changeIqd,
    components,
  };
}

/**
 * What each cart line saves under the server's deal, by line key (the quote's savings follow the
 * cart's line order): the deal's exact saving (20 % of 15,000 → 3,000), never the rounded share —
 * rounding is its own line in the summary.
 */
export function lineSavings(cart: Pick<CartState, 'lines'>, order: Pick<OrderQuote, 'lineSavingsIqd' | 'dealLineSavingsIqd'> | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!order) return out;
  const savings = order.dealLineSavingsIqd ?? order.lineSavingsIqd;
  cart.lines.forEach((l, i) => {
    const s = savings[i] ?? 0;
    if (s > 0) out.set(l.key, s);
  });
  return out;
}

export interface CheckoutChoices {
  cart: CartState;
  dropoff: DeliveryPoint;
  streetHandover: boolean;
  recipient: Recipient;
  scheduledFor: Date | null;
  paymentMethod: 'cash' | 'wallet';
  fees: { deliveryFeeIqd: number; serviceFeeIqd: number };
  /** The discount `orders.quote` showed (0 = none): the server refuses a different one (`deal_changed`). */
  discountIqd?: number;
  /** For the kitchen (the card and receipt show it). */
  note?: string;
  /** For the courier only (his drop-off stop; never the kitchen card) — UI/UX audit M-09. */
  courierNote?: string;
  /** The checkout attempt's idempotency key (`place-attempt.ts`): re-sent on every retry. */
  clientRequestId?: string;
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
    ...(c.discountIqd !== undefined ? { discountIqd: c.discountIqd } : {}),
    tipIqd: 0,
    options: { streetHandover: c.streetHandover },
    paymentMethod: c.paymentMethod,
    dropoff: c.dropoff,
    ...(c.scheduledFor ? { scheduledFor: c.scheduledFor } : {}),
    ...(c.note?.trim() ? { note: c.note.trim().slice(0, 500) } : {}),
    ...(c.courierNote?.trim() ? { courierNote: c.courierNote.trim().slice(0, 300) } : {}),
    ...(c.clientRequestId ? { clientRequestId: c.clientRequestId } : {}),
  };
}

/**
 * The `orders.quote` input for a cart: the same lines and drop-off `place` will get, without the fee
 * and discount expectations (the quote is what sets them).
 */
export function orderQuoteInput(cart: CartState, dropoff: DeliveryPoint, streetHandover: boolean): PlaceOrderInput {
  const full = buildPlaceOrderInput({ cart, dropoff, streetHandover, recipient: { kind: 'me' }, scheduledFor: null, paymentMethod: 'cash', fees: { deliveryFeeIqd: 0, serviceFeeIqd: 0 } });
  const { deliveryFeeIqd: _d, serviceFeeIqd: _s, participants: _p, ...rest } = full;
  return { ...rest, lines: (rest.lines ?? []).map(({ participantRef: _r, ...l }) => l) };
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

/** "7:30 م" for a slot: the city's one clock (packages/i18n), whatever the phone's time zone. */
export function clock12(d: Date): string {
  return formatClock(d);
}

/** Errors `orders.place` can answer with that the checkout explains in its own words. */
export type PlaceProblem = 'price_changed' | 'deal_changed' | 'catalog_item_unavailable' | 'modifier_invalid' | 'new_customer_cash_cap' | 'merchant_paused' | 'wallet_insufficient' | 'other';

/**
 * The wallet row at checkout (C-04): usable when the balance covers the exact price; otherwise shown
 * disabled with how much is missing. `null` balance = still loading.
 */
export function walletChoice(balanceIqd: number | null, priceIqd: number): { usable: boolean; missingIqd: number } {
  if (balanceIqd === null) return { usable: false, missingIqd: 0 };
  const missingIqd = Math.max(0, priceIqd - balanceIqd);
  return { usable: missingIqd === 0 && priceIqd > 0, missingIqd };
}

/**
 * C-06: the restaurant's other live deals that did not apply — deals never combine; the server
 * applied the one that saves most. Their labels, for "العروض ما تنجمع".
 */
export function otherDeals(deals: ReadonlyArray<{ dealId: string; label_ar: string; label_en: string }>, applied: Pick<AppliedDiscount, 'promotionId' | 'funder'> | null): Array<{ dealId: string; label_ar: string; label_en: string }> {
  if (!applied || applied.funder !== 'merchant') return [];
  return deals.filter((d) => d.dealId !== applied.promotionId);
}

export function placeProblem(code: string | null): PlaceProblem {
  switch (code) {
    case 'price_changed':
    case 'deal_changed':
    case 'catalog_item_unavailable':
    case 'modifier_invalid':
    case 'new_customer_cash_cap':
    case 'merchant_paused':
    case 'wallet_insufficient':
      return code;
    default:
      return 'other';
  }
}
