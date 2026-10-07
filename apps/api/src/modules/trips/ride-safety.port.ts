import type { LatLng, Trip } from '@driver/contracts';

/**
 * s1 «رمز المشوار» (ride step 3): the night-ride codes live on the orders (`orders.start_code`); trips
 * asks for one when a ride's pickup is completed. Orders binds it at start-up (orders depends on trips,
 * not the other way round), like the hand-over check.
 */
export interface TripStartCodes {
  /** The code the ride must start with, or null when it needs none. */
  codeOf(orderId: string): Promise<string | null>;
}

/** Until orders binds the real one there are no codes (only orders can set one, so none can be missed). */
export class NoStartCodes implements TripStartCodes {
  async codeOf(): Promise<string | null> {
    return null;
  }
}

/**
 * d3 «السايق قريب، اطلع هسة»: seconds until the driver at `pin` reaches the ride's pickup by the one ETA
 * the rider's screen shows (tracking's `liveEta`). Tracking binds it at start-up; null = unknown.
 */
export interface TripRideNear {
  secondsToPickup(trip: Trip, orderId: string, pin: LatLng, now: Date): Promise<number | null>;
}
