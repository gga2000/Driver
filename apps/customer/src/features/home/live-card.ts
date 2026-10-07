import type { Order } from '@driver/contracts';
import type { LiveStagePalette } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';

/** Segments on the home live-order card's progress bar (discovery §6: "▰▰▰▱ دا يتحضّر"). */
export const LIVE_SEGMENTS = 4;

type LiveOrder = Pick<Order, 'type' | 'state'>;

/** On the way, the last segment never quite fills before the door: it waits for «وصل». */
const ON_THE_WAY_MIN = 0.08;
const ON_THE_WAY_MAX = 0.92;

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

/** How far along an order's states go, to tell which of two reads of the same order is newer. */
const STATE_ORDER: readonly Order['state'][] = ['placed', 'merchant_accepted', 'matched', 'preparing', 'ready', 'picked_up', 'delivered', 'completed', 'closed'];

/**
 * Of two reads of the same order (home's list and its tracking read, each refreshed on its own
 * clock), the one further along; the tracking read when they agree (it carries the live times).
 */
export function newerRead<T extends LiveOrder>(list: T, tracked: T | null | undefined): T {
  if (!tracked) return list;
  const rank = (o: LiveOrder) => STATE_ORDER.indexOf(o.state);
  return rank(tracked) >= rank(list) ? tracked : list;
}

/** The status words: a ride's states read as the trip does ("ندور لك سايق", "السايق بالطريق إلك"). */
export function liveStatusKey(o: LiveOrder): MessageKey {
  if (o.type === 'ride' && o.state === 'placed') return 'trip.status.offered';
  if (o.type === 'ride' && o.state === 'matched') return 'trip.status.en_route_to_pickup';
  return `order.status.${o.state}` as MessageKey;
}

/**
 * How far along the bar the order is, 0–1, for the courier riding on it (Ali's Yes, home effects
 * "liveride", 2026-10-07): the end of the current step's segment, except on the way (`picked_up`),
 * where the last segment fills as the arrival time nears, from the pickup to the live estimate, so
 * the scooter moves toward the door as he gets closer. Without both times it waits halfway along.
 */
export function liveProgress(o: LiveOrder & Pick<Order, 'pickedUpAt'>, eta: Date | null, now: number): number {
  if (o.state !== 'picked_up') return liveStep(o) / LIVE_SEGMENTS;
  const from = o.pickedUpAt ? new Date(o.pickedUpAt).getTime() : null;
  const to = eta ? eta.getTime() : null;
  const share = from !== null && to !== null && to > from ? (now - from) / (to - from) : 0.5;
  return (LIVE_SEGMENTS - 1 + Math.min(ON_THE_WAY_MAX, Math.max(ON_THE_WAY_MIN, share))) / LIVE_SEGMENTS;
}

/**
 * Where the order is, as the card shows it (Ali, 2026-10-07: each stage looks different). Food: sent
 * to the restaurant, the kitchen said yes, cooking, ready, on the way. A ride: looking for a driver,
 * the driver coming, on the trip.
 */
export type LiveStage = 'sent' | 'accepted' | 'cooking' | 'ready' | 'onTheWay' | 'searching' | 'driverComing' | 'onTrip';

export function liveStage(o: LiveOrder): LiveStage {
  if (o.type === 'ride') return o.state === 'placed' ? 'searching' : o.state === 'matched' ? 'driverComing' : 'onTrip';
  switch (o.state) {
    case 'placed':
      return 'sent';
    case 'merchant_accepted':
      return 'accepted';
    case 'preparing':
      return 'cooking';
    case 'ready':
      return 'ready';
    default:
      return 'onTheWay';
  }
}

/** Which of the card's colour looks (`theme.liveStages`) a stage wears: a ride borrows the food looks. */
export const STAGE_LOOK: Record<LiveStage, keyof LiveStagePalette> = {
  sent: 'sent',
  accepted: 'accepted',
  cooking: 'cooking',
  ready: 'ready',
  onTheWay: 'onTheWay',
  searching: 'sent',
  driverComing: 'accepted',
  onTrip: 'onTheWay',
};

const STAGE_TITLE: Record<LiveStage, MessageKey> = {
  sent: 'home.stage.sent',
  accepted: 'home.stage.accepted',
  cooking: 'home.stage.cooking',
  ready: 'home.stage.ready',
  onTheWay: 'home.stage.on_the_way',
  searching: 'home.stage.searching',
  driverComing: 'home.stage.driver_coming',
  onTrip: 'home.stage.on_trip',
};

/** The stage's title on the card: «وصل للمطعم», «المطعم قبل», «دا يتحضّر», «طلبك جاهز», «بالطريق إلك». */
export function stageTitleKey(stage: LiveStage): MessageKey {
  return STAGE_TITLE[stage];
}

/** The word over the arrival time: the food «يوصل»; the driver «يوصلك» (to the pickup); on the trip «توصل». */
export function stageEtaKey(stage: LiveStage): MessageKey {
  if (stage === 'driverComing' || stage === 'searching') return 'home.stage.eta_pickup';
  if (stage === 'onTrip') return 'home.stage.eta_trip';
  return 'home.stage.eta_food';
}
