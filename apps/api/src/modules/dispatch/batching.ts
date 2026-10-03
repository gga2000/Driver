import type { LatLng } from '@driver/contracts';
import { etaMin } from './geo.js';

/** One food/grocery order as batching sees it. */
export interface BatchOrder {
  tripId: string;
  pickup: LatLng;
  dropoffZoneId: string;
  readyAt: Date;
  /** Hot items never wait more than `maxHotWaitMin` from `ready`. */
  hot: boolean;
  /** Already in the courier's bag. */
  pickedUp?: boolean;
}

/** Spec §3 batching limits (per city config; the vehicle limit comes from vehicles.ts). */
export interface BatchRules {
  /** Max orders on one courier: 2 per bike, 3 per tuktuk. */
  maxBatch: number;
  /** A further pickup may delay the batch's departure by at most this many minutes. */
  maxDetourMin: number;
  /** Hot items leave for the customer within this many minutes of `ready`. */
  maxHotWaitMin: number;
}

export interface BatchContext {
  now: Date;
  courierAt: LatLng;
  isAdjacent(a: string, b: string): boolean;
  /** Minutes between two points; defaults to haversine × 1.4 at 25 km/h. */
  travelMin?: (a: LatLng, b: LatLng) => number;
}

export type BatchVerdict =
  | { ok: true; departAt: Date; addedMin: number }
  | { ok: false; reason: 'batch_full' | 'zone_mismatch' | 'detour_too_long' | 'hot_wait_too_long'; detail?: string };

/**
 * When the courier leaves the last pickup: drive to each pending pickup in order, waiting for
 * `readyAt` where needed. Orders already picked up add nothing.
 */
export function departureTime(orders: readonly BatchOrder[], ctx: BatchContext): Date {
  const travel = ctx.travelMin ?? etaMin;
  let t = ctx.now.getTime();
  let pos = ctx.courierAt;
  for (const o of orders) {
    if (o.pickedUp) continue;
    t += travel(pos, o.pickup) * 60_000;
    t = Math.max(t, o.readyAt.getTime());
    pos = o.pickup;
  }
  return new Date(t);
}

/**
 * The four batching rules of spec §3, in order: vehicle limit; same or adjacent drop-off zone;
 * the extra pickup delays departure by ≤ 4 min; no hot item waits > 10 min from ready. Returns the
 * honest batched departure time the customer is shown.
 */
export function canBatch(current: readonly BatchOrder[], next: BatchOrder, rules: BatchRules, ctx: BatchContext): BatchVerdict {
  if (current.length + 1 > rules.maxBatch) return { ok: false, reason: 'batch_full', detail: `${current.length}/${rules.maxBatch}` };
  const far = current.find((o) => !ctx.isAdjacent(o.dropoffZoneId, next.dropoffZoneId));
  if (far) return { ok: false, reason: 'zone_mismatch', detail: `${far.dropoffZoneId}↔${next.dropoffZoneId}` };

  const without = departureTime(current, ctx);
  const withNext = departureTime([...current, next], ctx);
  const addedMin = (withNext.getTime() - without.getTime()) / 60_000;
  if (addedMin > rules.maxDetourMin) return { ok: false, reason: 'detour_too_long', detail: addedMin.toFixed(1) };

  for (const o of [...current, next]) {
    if (!o.hot) continue;
    const waitMin = (withNext.getTime() - o.readyAt.getTime()) / 60_000;
    if (waitMin > rules.maxHotWaitMin) return { ok: false, reason: 'hot_wait_too_long', detail: `${o.tripId} ${waitMin.toFixed(1)}` };
  }
  return { ok: true, departAt: withNext, addedMin: Math.round(addedMin * 10) / 10 };
}
