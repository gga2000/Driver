import { travelMinutes, type OrderTracking, type VehicleClass } from '@driver/contracts';
import type { LngLat } from './geo';

/** A batched courier's other drop before mine costs about this much (dispatch spec §3: ≤ 4 min). */
export const MIN_PER_EARLIER_DROP = 4;
/** Late enough to say so: the live ETA beyond the promise by more than this. */
export const LATE_AFTER_MIN = 5;
/** Delivery fee comes back as credit past the promise + 20 min (domain §9 "cold / late"). */
export const CREDIT_AFTER_MIN = 20;
/** A fix older than this means we lost his signal ("آخر موقع قبل…"). */
export const SIGNAL_LOST_AFTER_SEC = 45;

const MIN = 60_000;

function myStop(v: OrderTracking, type: 'pickup' | 'dropoff'): LngLat | null {
  return v.trip?.stops.find((s) => s.mine && (s.type === type || (type === 'pickup' && s.type === 'shop')))?.target ?? null;
}

function vehicleOf(v: OrderTracking): VehicleClass {
  return v.courier?.vehicleClass ?? v.order.minVehicleClass ?? (v.order.type === 'ride' ? 'car' : 'bike');
}

/**
 * Live arrival estimate at the customer's door (or, for a ride not yet picked up, at the pickup).
 * Uses the courier's latest position when we have one; otherwise the kitchen's ready time and the
 * kitchen → door ride. Null once delivered or when nothing is known about where things are.
 */
export function liveEta(v: OrderTracking, courier: LngLat | null, now: Date): Date | null {
  const o = v.order;
  const vehicle = vehicleOf(v);
  const at = (minutes: number) => new Date(now.getTime() + minutes * MIN);

  if (o.type === 'ride') {
    const pickup = myStop(v, 'pickup');
    const drop = myStop(v, 'dropoff');
    const state = v.trip?.state;
    if (!state || state === 'completed') return null;
    if (state === 'in_transit' || state === 'arrived_dropoff') return drop && courier ? at(travelMinutes(courier, drop, vehicle)) : null;
    if (state === 'arrived_pickup') return now;
    return pickup && courier ? at(travelMinutes(courier, pickup, vehicle)) : null;
  }

  if (o.state === 'delivered' || o.state === 'closed' || o.deliveredAt) return null;
  const door = v.dropoff?.pin ?? myStop(v, 'dropoff');
  const kitchen = v.merchant?.pin ?? myStop(v, 'pickup');
  if (!door) return null;
  const extra = (v.trip?.dropsBeforeMine ?? 0) * MIN_PER_EARLIER_DROP;

  if (o.pickedUpAt || o.state === 'picked_up') {
    const from = courier ?? kitchen;
    return from ? at(travelMinutes(from, door, vehicle) + extra) : null;
  }
  if (!kitchen) return null;
  const readyMs = (o.readyAt ?? o.promisedReadyAt)?.getTime() ?? null;
  const courierAtKitchenMs = courier ? now.getTime() + travelMinutes(courier, kitchen, vehicle) * MIN : now.getTime();
  const leaveMs = Math.max(courierAtKitchenMs, readyMs ?? now.getTime(), now.getTime());
  return new Date(leaveMs + (travelMinutes(kitchen, door, vehicle) + extra) * MIN);
}

/** Minutes the live ETA runs past the promise, when it is past by more than `LATE_AFTER_MIN`; else 0. */
export function lateMinutes(eta: Date | null, promisedAt: Date | null): number {
  if (!eta || !promisedAt) return 0;
  const late = Math.round((eta.getTime() - promisedAt.getTime()) / MIN);
  return late > LATE_AFTER_MIN ? late : 0;
}

/** Whole minutes ago (≥ 1) when the last fix is stale, else null. `ageSec` is the server's age plus time since the read. */
export function signalLostMinutes(ageSec: number | null): number | null {
  if (ageSec === null || ageSec < SIGNAL_LOST_AFTER_SEC) return null;
  return Math.max(1, Math.round(ageSec / 60));
}
