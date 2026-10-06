import type { OrderTracking, QuickReplyKey } from '@driver/contracts';
import { liveEta } from '@/features/track/eta';
import type { LngLat } from '@/features/track/geo';
import { courierAtDoor, phaseOf } from '@/features/track/timeline';

/**
 * The chat header knows where he is (joy l7, audit L-13): «بالطريق · 4 دقايق» while the order (or the
 * ride's driver) is coming, «عند بابك» once he pressed "وصلت" at my door; nothing before he left or
 * after it ended. The quick replies follow the moment: at the door «طالع هسة» comes first, on the way
 * «تعال للباب الثاني».
 */
export type ChatLive = { kind: 'on_the_way'; minutes: number } | { kind: 'at_door' } | null;

export function chatLive(v: OrderTracking | null | undefined, courier: LngLat | null, now: Date): ChatLive {
  if (!v) return null;
  const phase = phaseOf(v);
  if (courierAtDoor(v) || phase === 'at_pickup' || phase === 'unreachable') return { kind: 'at_door' };
  const moving = phase === 'on_the_way' || (v.order.type === 'ride' && phase === 'to_pickup');
  if (!moving) return null;
  const eta = liveEta(v, courier, now);
  if (!eta) return null;
  return { kind: 'on_the_way', minutes: Math.max(1, Math.round((eta.getTime() - now.getTime()) / 60_000)) };
}

const AT_DOOR_FIRST: readonly QuickReplyKey[] = ['customer_coming_out', 'customer_wait_minute', 'customer_other_gate', 'customer_ring_bell', 'customer_leave_at_door'];
const ON_THE_WAY_FIRST: readonly QuickReplyKey[] = ['customer_other_gate', 'customer_leave_at_door', 'customer_ring_bell', 'customer_wait_minute', 'customer_coming_out'];

/** The server's allowed replies, reordered for the moment (never adding one the server didn't allow). */
export function orderQuickReplies(keys: readonly QuickReplyKey[], live: ChatLive): QuickReplyKey[] {
  if (!live) return [...keys];
  const order = live.kind === 'at_door' ? AT_DOOR_FIRST : ON_THE_WAY_FIRST;
  const rank = (k: QuickReplyKey) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  return [...keys].map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
}
