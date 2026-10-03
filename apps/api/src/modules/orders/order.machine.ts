import type { OrderState, OrderType, VehicleClass } from '@driver/contracts';
import { CATERING_ABOVE_IQD, ORDER_CAPS } from './orders.config.js';

/**
 * Order machine (domain §2) — pure, per order family.
 *
 * Merchant orders (food, grocery_catalog): `placed → merchant_accepted → preparing → ready →
 * picked_up → delivered → closed`; free cancel until accepted, fee after, no cancel after pickup
 * (dispute instead). Errands and parcels skip the merchant: `placed → picked_up → delivered`.
 * Rides: `placed → matched → completed → closed`, `matched → placed` when the driver drops out.
 * `picked_up → disputed` and `matched → disputed` carry the unreachable / courier-cancel defaults.
 */
type Table = Readonly<Record<OrderState, readonly OrderState[]>>;

const NONE: readonly OrderState[] = [];

const AFTER_DELIVERY = {
  delivered: ['closed', 'disputed'],
  closed: ['disputed', 'refunded'],
  disputed: ['closed', 'refunded'],
  refunded: NONE,
  merchant_rejected: NONE,
  customer_cancelled: NONE,
  platform_cancelled: NONE,
  failed: NONE,
} as const;

export const MERCHANT_ORDER_TRANSITIONS: Table = {
  placed: ['merchant_accepted', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
  merchant_accepted: ['preparing', 'ready', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
  preparing: ['ready', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
  ready: ['picked_up', 'customer_cancelled', 'platform_cancelled'],
  picked_up: ['delivered', 'disputed', 'failed'],
  matched: NONE,
  completed: NONE,
  ...AFTER_DELIVERY,
};

export const COURIER_ORDER_TRANSITIONS: Table = {
  placed: ['picked_up', 'customer_cancelled', 'platform_cancelled'],
  merchant_accepted: NONE,
  preparing: NONE,
  ready: NONE,
  picked_up: ['delivered', 'disputed', 'failed'],
  matched: NONE,
  completed: NONE,
  ...AFTER_DELIVERY,
};

export const RIDE_ORDER_TRANSITIONS: Table = {
  placed: ['matched', 'customer_cancelled', 'platform_cancelled'],
  matched: ['placed', 'completed', 'customer_cancelled', 'platform_cancelled', 'disputed', 'failed'],
  completed: ['closed', 'disputed'],
  merchant_accepted: NONE,
  preparing: NONE,
  ready: NONE,
  picked_up: NONE,
  ...AFTER_DELIVERY,
  delivered: NONE,
};

export const MERCHANT_ORDER_TYPES: readonly OrderType[] = ['food', 'grocery_catalog'];

export function transitionsFor(type: OrderType): Table {
  if (type === 'ride') return RIDE_ORDER_TRANSITIONS;
  if (MERCHANT_ORDER_TYPES.includes(type)) return MERCHANT_ORDER_TRANSITIONS;
  return COURIER_ORDER_TRANSITIONS;
}

export function canOrderTransition(type: OrderType, from: OrderState, to: OrderState): boolean {
  return transitionsFor(type)[from].includes(to);
}

/** Domain §6 event name for entering `to`. */
export function orderEventType(to: OrderState): string {
  switch (to) {
    case 'merchant_accepted':
      return 'order.accepted';
    case 'merchant_rejected':
      return 'order.rejected';
    case 'customer_cancelled':
    case 'platform_cancelled':
      return 'order.cancelled';
    default:
      return `order.${to}`;
  }
}

/** States a customer can still open a dispute from (domain §9: until `closed`). */
export const DISPUTABLE_STATES: readonly OrderState[] = ['delivered', 'completed'];

/**
 * Smallest vehicle class for an order by value and item count (review A.16): bike ≤ 25,000 and ≤ 6
 * items, tuktuk ≤ 60,000, car above that; above 100,000 it is also a dispatcher-handled catering request.
 */
export function vehicleRequirement(itemsTotalIqd: number, itemCount: number): { minVehicleClass: VehicleClass; catering: boolean } {
  const fit = ORDER_CAPS.find((c) => itemsTotalIqd <= c.maxItemsIqd && itemCount <= c.maxItemCount);
  return { minVehicleClass: fit?.vehicleClass ?? 'car', catering: itemsTotalIqd > CATERING_ABOVE_IQD };
}
