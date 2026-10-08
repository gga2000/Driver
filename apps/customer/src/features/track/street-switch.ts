import { FOOD_RATED_TYPES, type Order } from '@driver/contracts';

/**
 * «خليه يسلّمني بالشارع» on a live order (HUNT-01, decision D-8): switched off until the server has
 * `orders.switchHandover` (re-quote −250 before pickup, tell the courier, show it on the receipt).
 * `StreetPanel` calls no server yet, so offering it would promise a saving and a meeting place nobody
 * is told about. Turn this on in the same change that wires the panel to that procedure. The
 * checkout's street option is a separate thing and stays.
 */
export const LIVE_STREET_SWITCH_ENABLED = false;

/** Whether the live order screen offers the street hand-over row (food, before pickup, still live). */
export function streetSwitchOffered(order: Pick<Order, 'type' | 'pickedUpAt'>, live: boolean, enabled: boolean = LIVE_STREET_SWITCH_ENABLED): boolean {
  return enabled && (FOOD_RATED_TYPES as readonly string[]).includes(order.type) && !order.pickedUpAt && live;
}
