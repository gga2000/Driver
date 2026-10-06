import type { DriverPin, Trip } from '@driver/contracts';

/**
 * The live fleet's motion (maps program o1), free of the map so it is unit-tested: pins glide to each
 * new fix instead of jumping, point where the driver is heading, and fade when his GPS goes quiet.
 */
export const FLEET_RULES = {
  /** A move takes this long (fixes arrive about every 2 s). */
  glideMs: 1_800,
  /** No fix for this long: the pin fades (he may have lost signal or closed the app). */
  quietMs: 45_000,
} as const;

export type LngLatTuple = [number, number];

/** Eased point between `a` and `b` at `k` (0–1): fast start, gentle stop. */
export function glideAt(a: LngLatTuple, b: LngLatTuple, k: number): LngLatTuple {
  const t = Math.max(0, Math.min(1, k));
  const e = 1 - (1 - t) * (1 - t);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
}

/** His last fix is older than `quietMs`. */
export function isQuiet(lastSeenMs: number | null | undefined, nowMs: number): boolean {
  return lastSeenMs !== null && lastSeenMs !== undefined && nowMs - lastSeenMs > FLEET_RULES.quietMs;
}

/**
 * Couriers carrying an order predicted to be late (maps program o4): the map rings them. From the
 * at-risk order ids through the live trips to whoever holds each trip.
 */
export function atRiskDrivers(atRiskOrderIds: readonly string[], trips: readonly Pick<Trip, 'courierId' | 'stops'>[]): Set<string> {
  const risky = new Set(atRiskOrderIds);
  const out = new Set<string>();
  for (const trip of trips) if (trip.courierId && trip.stops.some((s) => s.orderId && risky.has(s.orderId))) out.add(trip.courierId);
  return out;
}

/** The pin's heading when the app or his movement gave one. */
export function headingOf(pin: Pick<DriverPin, 'heading'>): number | null {
  return pin.heading ?? null;
}
