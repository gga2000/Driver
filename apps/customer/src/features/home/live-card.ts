import type { Order } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/** Segments on the home live-order card's progress bar (discovery §6: "▰▰▰▱ دا يتحضّر"). */
export const LIVE_SEGMENTS = 4;

type LiveOrder = Pick<Order, 'type' | 'state'>;

/**
 * How many segments are filled. Food: sent (1), the kitchen said yes (2), cooking or ready (3), on the
 * way (4). Ride: looking for a driver (1), driver coming (2), on the trip (4). Never 0: a card on home
 * means something is already moving.
 */
export function liveStep(o: LiveOrder): number {
  switch (o.state) {
    case 'placed':
      return 1;
    case 'merchant_accepted':
    case 'matched':
      return 2;
    case 'preparing':
    case 'ready':
      return 3;
    default:
      return LIVE_SEGMENTS;
  }
}

/** The status words: a ride's states read as the trip does ("ندور لك سايق", "السايق بالطريق إلك"). */
export function liveStatusKey(o: LiveOrder): MessageKey {
  if (o.type === 'ride' && o.state === 'placed') return 'trip.status.offered';
  if (o.type === 'ride' && o.state === 'matched') return 'trip.status.en_route_to_pickup';
  return `order.status.${o.state}` as MessageKey;
}
