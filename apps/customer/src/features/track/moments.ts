import { NEAR_DROPOFF_M, type LatLng } from '@driver/contracts';
import { distanceM } from './geo';
import type { Phase } from './timeline';

/** The tracking screen's moments (maps program SP5b, joy f3): each gets a buzz (and most a soft sound) once. */
export type Moment = 'accepted' | 'picked_up' | 'near' | 'at_door' | 'delivered';

/** What one read of the order says, for comparing with the previous read. */
export interface MomentSnapshot {
  orderId: string;
  phase: Phase;
  /** The "almost there" card's moment: about two minutes out with the food (food orders only). */
  near: boolean;
  /** He pressed "وصلت" at my door (no other drop before mine). */
  door: boolean;
}

const BEFORE_ACCEPT: ReadonlySet<Phase> = new Set(['waiting_merchant']);
const ENDED: ReadonlySet<Phase> = new Set(['cancelled', 'failed', 'disputed']);
const AT_DOOR: ReadonlySet<Phase> = new Set(['arrived', 'done']);

/**
 * Moments between two reads of the same order. The first read of an order (screen opened, app
 * resumed) is never a moment: the customer should not hear "accepted" for something that happened an
 * hour ago.
 */
export function momentsBetween(prev: MomentSnapshot | null, next: MomentSnapshot): Moment[] {
  if (!prev || prev.orderId !== next.orderId || ENDED.has(next.phase)) return [];
  const out: Moment[] = [];
  if (BEFORE_ACCEPT.has(prev.phase) && !BEFORE_ACCEPT.has(next.phase) && !AT_DOOR.has(next.phase)) out.push('accepted');
  if (prev.phase !== 'on_the_way' && !AT_DOOR.has(prev.phase) && next.phase === 'on_the_way') out.push('picked_up');
  if (!prev.near && !prev.door && next.near && !next.door && !AT_DOOR.has(next.phase)) out.push('near');
  if (!prev.door && next.door && !AT_DOOR.has(next.phase)) out.push('at_door');
  if (!AT_DOOR.has(prev.phase) && next.phase === 'arrived') out.push('delivered');
  return out;
}

/** The courier, with the food, close enough to the door that the customer should get ready. */
export function isNear(phase: Phase, courier: LatLng | null, door: LatLng | null, isFood: boolean): boolean {
  return isFood && phase === 'on_the_way' && courier !== null && door !== null && distanceM(courier, door) <= NEAR_DROPOFF_M;
}

/** The card shows once the courier's ETA to my door is this close (joy spec f3: "about 2 minutes out"). */
export const ALMOST_THERE_ETA_MS = 2 * 60_000;

/**
 * Which card the live map shows (joy spec f3, L-05). `door` once he pressed "وصلت" at my door — the
 * status line says "عند بابك" at the same moment, so the two never disagree. Before that `near` from
 * the first of: the server's "almost there" fix (`courierNearAt`, the same moment as the push), an ETA
 * of two minutes or less, or the 300 m line on the client's own fix. Food orders on their way only.
 */
export function almostThere(i: {
  phase: Phase;
  food: boolean;
  atDoor: boolean;
  courier: LatLng | null;
  door: LatLng | null;
  nearAt: Date | null;
  eta: Date | null;
  now: number;
}): 'near' | 'door' | null {
  if (!i.food || i.phase !== 'on_the_way') return null;
  if (i.atDoor) return 'door';
  if (i.nearAt) return 'near';
  if (i.eta && i.eta.getTime() - i.now <= ALMOST_THERE_ETA_MS) return 'near';
  return isNear(i.phase, i.courier, i.door, i.food) ? 'near' : null;
}
