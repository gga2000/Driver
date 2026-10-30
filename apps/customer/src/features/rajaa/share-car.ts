import type { RequestShareInvite, RequestShareView } from '@driver/contracts';
import { REQUEST_SHARE_PLACES_MAX } from '@driver/contracts';

/**
 * Step 6 (Ali's item 56, rules s1–s4): sharing a picked private car by link. Pure helpers for the
 * booker's panel and the friend's page; the server decides every amount.
 */

export type ShareSlot = 'me' | 'friend' | 'empty';

/** One slot per person in the car, the booker's first, then friends who hold places, then the empty ones. */
export function shareSlots(s: Pick<RequestShareView, 'people' | 'bookerPlaces' | 'members'>): ShareSlot[] {
  const friends = s.members.filter((m) => m.state === 'joined' || m.state === 'paid').reduce((n, m) => n + m.places, 0);
  const me = Math.min(s.bookerPlaces, s.people);
  const taken = Math.min(friends, s.people - me);
  return [...Array<ShareSlot>(me).fill('me'), ...Array<ShareSlot>(taken).fill('friend'), ...Array<ShareSlot>(Math.max(0, s.people - me - taken)).fill('empty')];
}

/** Friends to list on the booker's panel: those holding or who paid (a friend who left is not shown). */
export function shareFriends<M extends { state: RequestShareView['members'][number]['state'] }>(members: readonly M[]): M[] {
  return members.filter((m) => m.state === 'joined' || m.state === 'paid');
}

/** How many places he may pick on the join page. */
export function joinPlacesMax(v: Pick<RequestShareInvite, 'placesLeft'>): number {
  return Math.max(0, Math.min(v.placesLeft, REQUEST_SHARE_PLACES_MAX));
}

export type JoinPhase = 'join' | 'joined' | 'full' | 'closed' | 'done' | 'ended';

/**
 * What the friend's page shows: his places (held, or paid once the trip ended), the join form, or
 * why he can't join (full, closed, the trip ended without him).
 */
export function joinPhase(v: Pick<RequestShareInvite, 'state' | 'open' | 'placesLeft' | 'myState'>): JoinPhase {
  if (v.myState === 'paid') return 'done';
  if (v.myState === 'joined') return v.state === 'matched' || v.state === 'driver_arrived' ? 'joined' : 'ended';
  if (v.myState === 'released') return 'ended';
  if (v.state !== 'matched' && v.state !== 'driver_arrived') return 'ended';
  if (!v.open) return 'closed';
  if (v.placesLeft === 0) return 'full';
  return 'join';
}
