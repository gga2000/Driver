/**
 * Minimal read model the events module needs from trips (edge-case §10): when was an order
 * detached from a trip? An event for a (trip, order) pair that arrives after `detached_at` is a
 * late replay and is quarantined. The trips rewrite (Step 4) binds a Prisma implementation over
 * `trip_orders`; until then the in-memory one serves tests and the simulator.
 *
 * The token is a registered symbol so the events module can reference it without importing
 * this module's runtime (trips → events is the only module-level dependency direction).
 */
export interface TripOrderLookup {
  /** `detached_at` of the latest attachment of `orderId` to `tripId`; null while attached or unknown. */
  detachedAt(tripId: string, orderId: string): Promise<Date | null>;
}

export const TRIP_ORDER_LOOKUP = Symbol.for('driver.trips.TripOrderLookup');

export class InMemoryTripOrderLookup implements TripOrderLookup {
  private readonly detached = new Map<string, Date>();

  async detachedAt(tripId: string, orderId: string): Promise<Date | null> {
    return this.detached.get(key(tripId, orderId)) ?? null;
  }

  markDetached(tripId: string, orderId: string, at: Date): void {
    this.detached.set(key(tripId, orderId), at);
  }

  markAttached(tripId: string, orderId: string): void {
    this.detached.delete(key(tripId, orderId));
  }
}

function key(tripId: string, orderId: string): string {
  return `${tripId}\u0000${orderId}`;
}
