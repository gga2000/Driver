import { NEAR_DROPOFF_M, type LatLng, type PublicSeason } from '@driver/contracts';
import { distanceM } from './geo';
import type { Phase } from './timeline';

/**
 * The tracking screen's moments (maps program SP5b, joy f3; rides J1c f4): each gets a buzz (and most
 * a soft sound) once. Rides add the two peaks a stranger brings: `matched` (a driver took it) and
 * `driver_here` (he is at the pickup, the free wait is running).
 */
export type Moment = 'accepted' | 'picked_up' | 'near' | 'at_door' | 'delivered' | 'matched' | 'driver_here' | 'courier_assigned';

/** What one read of the order says, for comparing with the previous read. */
export interface MomentSnapshot {
  orderId: string;
  phase: Phase;
  /** The "almost there" card's moment: about two minutes out with the food (food orders only). */
  near: boolean;
  /** He pressed "وصلت" at my door (no other drop before mine). */
  door: boolean;
  /** A taxi / tuktuk ride (its own two moments). */
  ride?: boolean;
  /** A courier has accepted the job (food: the driver reveal's moment, joy l2). Absent = unknown. */
  courier?: boolean;
}

const BEFORE_ACCEPT: ReadonlySet<Phase> = new Set(['waiting_merchant']);
const ENDED: ReadonlySet<Phase> = new Set(['cancelled', 'failed', 'disputed']);
const AT_DOOR: ReadonlySet<Phase> = new Set(['arrived', 'done']);
const SEARCHING: ReadonlySet<Phase> = new Set(['searching', 'reassigning']);
const DRIVER_COMING: ReadonlySet<Phase> = new Set(['to_pickup', 'at_pickup']);

/**
 * Moments between two reads of the same order. The first read of an order (screen opened, app
 * resumed) is never a moment: the customer should not hear "accepted" for something that happened an
 * hour ago.
 */
export function momentsBetween(prev: MomentSnapshot | null, next: MomentSnapshot): Moment[] {
  if (!prev || prev.orderId !== next.orderId || ENDED.has(next.phase)) return [];
  const out: Moment[] = [];
  if (next.ride && SEARCHING.has(prev.phase) && DRIVER_COMING.has(next.phase)) out.push('matched');
  if (next.ride && prev.phase !== 'at_pickup' && next.phase === 'at_pickup') out.push('driver_here');
  if (BEFORE_ACCEPT.has(prev.phase) && !BEFORE_ACCEPT.has(next.phase) && !AT_DOOR.has(next.phase)) out.push('accepted');
  // Joy l2: a courier took my food order (before he has it; a later read with the food on its way is not "news").
  if (!next.ride && prev.courier === false && next.courier === true && next.phase !== 'on_the_way' && !AT_DOOR.has(next.phase)) out.push('courier_assigned');
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

/** The two firm buzzes of "your driver is here" are this far apart (L-02). */
export const DRIVER_HERE_GAP_MS = 120;
/** "لگينالك سايق: عباس" stays this long after the accept, then "عباس بالطريق إلك". */
export const MATCHED_STATUS_MS = 4_000;

export type MomentHaptic = 'success' | 'medium' | 'light' | 'heavy';
export type MomentCue = 'accepted' | 'picked_up' | 'near' | 'delivered';

/**
 * The delivered moment's buzz comes from the arrival screen itself; the others buzz here. The door
 * has no sound of its own: the knock is enough, and "near" already chimed.
 */
const FEEDBACK: Record<Moment, { haptics: MomentHaptic[]; cue: MomentCue | null }> = {
  accepted: { haptics: ['light'], cue: 'accepted' },
  picked_up: { haptics: ['medium'], cue: 'picked_up' },
  near: { haptics: ['success'], cue: 'near' },
  at_door: { haptics: ['medium'], cue: null },
  delivered: { haptics: [], cue: 'delivered' },
  matched: { haptics: ['success'], cue: 'accepted' },
  driver_here: { haptics: ['heavy', 'heavy'], cue: 'near' },
  // Food's reveal is a light touch: the kitchen's yes already chimed.
  courier_assigned: { haptics: ['light'], cue: null },
};

/**
 * What a moment does to the senses. On a quiet day (Console, J1a) no sound plays and the celebratory
 * success buzz becomes a plain one; the driver-here alarm keeps its two firm buzzes (it is
 * information: the free wait is running).
 */
export function momentFeedback(m: Moment, today: Pick<PublicSeason, 'celebrations' | 'sounds'>): { haptics: MomentHaptic[]; cue: MomentCue | null } {
  const f = FEEDBACK[m];
  return {
    haptics: f.haptics.map((h) => (h === 'success' && !today.celebrations ? 'medium' : h)),
    cue: today.sounds ? f.cue : null,
  };
}

/** Within the first seconds after a driver accepted (server time), the status says who was found. */
export function rideMatchedFresh(acceptedAt: Date | null | undefined, now: number): boolean {
  return acceptedAt != null && now - acceptedAt.getTime() < MATCHED_STATUS_MS;
}

/** The driver reveal (joy l2): opening the order this soon after he accepted still shows it (he tapped the push). */
export const REVEAL_FRESH_MS = 60_000;
/** The reveal card closes by itself after this long; the courier stays on the float. */
export const REVEAL_SHOW_MS = 8_000;

/** Storage key marking that this phone already showed an order's driver reveal. */
export function revealSeenKey(orderId: string): string {
  return `driver.customer.reveal-seen.${orderId.replace(/[^\w.-]/g, '_')}`;
}

/**
 * Whether the reveal plays for this order now (joy l2): never twice on this phone (`seen`), and only
 * when the screen saw him accept (`liveTransition`) or the order was opened within a minute of it.
 * An order opened later just shows him on the float and in the sheet, without ceremony.
 */
export function revealPlays(i: { seen: boolean; liveTransition: boolean; acceptedAt: Date | null; now: number }): boolean {
  if (i.seen) return false;
  if (i.liveTransition) return true;
  return i.acceptedAt !== null && i.now - i.acceptedAt.getTime() >= 0 && i.now - i.acceptedAt.getTime() <= REVEAL_FRESH_MS;
}
