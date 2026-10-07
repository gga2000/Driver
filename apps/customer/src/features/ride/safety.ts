import { CHAT_LOST_ITEM_H, type OrderTracking } from '@driver/contracts';
import type { Phase } from '@/features/track/timeline';

/**
 * Taxi/tuktuk safety on the live ride screen (ride step 3): the night trip code (s1), «السايق قريب،
 * اطلع هسة» (d3) and «نسيت غرض بالسيارة؟» (s7). Pure, so the screen only wires them.
 */

/** Phases the rider still has to get in: the code shows from the search until the driver starts the ride. */
const BEFORE_BOARDING: ReadonlySet<Phase> = new Set(['searching', 'reassigning', 'to_pickup', 'at_pickup', 'unreachable']);

/** s1: the 4 digits to tell the driver, while the server shows them and the rider is not in yet. */
export function tripCodeOf(v: OrderTracking | undefined, phase: Phase | null): string | null {
  if (!v || v.order.type !== 'ride' || !phase || !BEFORE_BOARDING.has(phase)) return null;
  const code = v.trip?.startCode ?? null;
  return code && /^\d{4}$/.test(code) ? code : null;
}

/** d3: when the one ETA put the driver a minute from my pickup (the server stamps the pickup once). */
export function rideNearAt(v: OrderTracking | undefined, phase: Phase | null): Date | null {
  if (!v || v.order.type !== 'ride' || phase !== 'to_pickup') return null;
  return v.trip?.stops.find((s) => s.mine && s.type === 'pickup')?.courierNearAt ?? null;
}

/**
 * s7: until when «نسيت غرض بالسيارة؟» can still reopen the chat with the driver — the ride's end +
 * `CHAT_LOST_ITEM_H` — or null when it cannot (not a finished ride with a driver, or too late).
 */
export function lostItemUntil(v: OrderTracking | undefined, now: number): Date | null {
  if (!v || v.order.type !== 'ride' || !v.courier || v.trip?.state !== 'completed' || !v.trip.completedAt) return null;
  const until = v.trip.completedAt.getTime() + CHAT_LOST_ITEM_H * 3_600_000;
  return now < until ? new Date(until) : null;
}

/** Whether a time falls on a later Baghdad day than now ("لحد باجر 6:28 ص" rather than a bare clock). */
export function laterBaghdadDay(at: Date, now: number): boolean {
  const day = (ms: number) => Math.floor((ms + 3 * 3_600_000) / 86_400_000);
  return day(at.getTime()) > day(now);
}
