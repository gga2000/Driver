import { NEAR_DROPOFF_M, type LatLng } from '@driver/contracts';
import { distanceM } from './geo';
import type { Phase } from './timeline';

/** The tracking screen's moments (maps program SP5b): each gets a buzz and a soft sound once. */
export type Moment = 'accepted' | 'picked_up' | 'near' | 'delivered';

/** What one read of the order says, for comparing with the previous read. */
export interface MomentSnapshot {
  orderId: string;
  phase: Phase;
  /** The courier is within `NEAR_DROPOFF_M` of the door with the food (food orders only). */
  near: boolean;
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
  if (!prev.near && next.near && !AT_DOOR.has(next.phase)) out.push('near');
  if (!AT_DOOR.has(prev.phase) && next.phase === 'arrived') out.push('delivered');
  return out;
}

/** The courier, with the food, close enough to the door that the customer should get ready. */
export function isNear(phase: Phase, courier: LatLng | null, door: LatLng | null, isFood: boolean): boolean {
  return isFood && phase === 'on_the_way' && courier !== null && door !== null && distanceM(courier, door) <= NEAR_DROPOFF_M;
}
