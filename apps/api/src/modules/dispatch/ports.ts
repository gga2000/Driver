import { Logger } from '@nestjs/common';

/**
 * Narrow ports dispatch consumes from modules being built in parallel. Dispatch owns the offer
 * lifecycle; the owning modules implement these and get bound in `dispatch.module.ts`.
 */

/** Trips (Step 4): tell the trip it was offered / assigned. */
export interface TripOffersPort {
  offer(tripId: string, driverIds: string[], timeoutSec: number): Promise<void>;
  assign(tripId: string, driverId: string, opts?: { compensationIqd?: number; batchWith?: string[] }): Promise<void>;
}
export const TRIP_OFFERS = Symbol('TRIP_OFFERS');

/** Ledger (Step 6): money & ops §4 caps by role. Over cap = finish the current job, no new offers. */
export interface CapsPort {
  isOverCap(driverId: string): Promise<boolean>;
}
export const CAPS = Symbol('CAPS');

/** Routes (intercity departures): seats sold incl. walk-ups, and the low-fill cancel. */
export interface DeparturesPort {
  /** Seats filled including walk-ups; null when the departure is unknown. */
  seatsFilled(departureId: string): Promise<number | null>;
  cancelLowFill(departureId: string): Promise<void>;
}
export const DEPARTURES = Symbol('DEPARTURES');

// ───────────────────────── placeholders until the owners land ─────────────────────────

/** TODO(M2 Step 4 merge): replace with the TripsService-backed port. Logs only. */
export class UnwiredTripOffers implements TripOffersPort {
  private readonly logger = new Logger('TripOffersPort');

  async offer(tripId: string, driverIds: string[], timeoutSec: number): Promise<void> {
    this.logger.debug(`offer ${tripId} → ${driverIds.join(',')} (${timeoutSec}s) [trips port not wired]`);
  }

  async assign(tripId: string, driverId: string): Promise<void> {
    this.logger.debug(`assign ${tripId} → ${driverId} [trips port not wired]`);
  }
}

/** TODO(M2 Step 6 merge): replace with LedgerService caps by role. Nobody is over cap meanwhile. */
export class UnwiredCaps implements CapsPort {
  async isOverCap(): Promise<boolean> {
    return false;
  }
}

/** TODO(routes/departures): replace with the routes module. Unknown departures are never cancelled. */
export class UnwiredDepartures implements DeparturesPort {
  async seatsFilled(): Promise<number | null> {
    return null;
  }

  async cancelLowFill(): Promise<void> {}
}

// ───────────────────────── fakes for tests and the simulator ─────────────────────────

export class FakeTripOffers implements TripOffersPort {
  readonly offers: Array<{ tripId: string; driverIds: string[]; timeoutSec: number }> = [];

  readonly assigns: Array<{ tripId: string; driverId: string; compensationIqd: number; batchWith: string[] }> = [];

  async offer(tripId: string, driverIds: string[], timeoutSec: number): Promise<void> {
    this.offers.push({ tripId, driverIds: [...driverIds], timeoutSec });
  }

  async assign(tripId: string, driverId: string, opts: { compensationIqd?: number; batchWith?: string[] } = {}): Promise<void> {
    this.assigns.push({ tripId, driverId, compensationIqd: opts.compensationIqd ?? 0, batchWith: opts.batchWith ?? [] });
  }

  /** Every driver ever offered this trip, in order. */
  offeredTo(tripId: string): string[] {
    return this.offers.filter((o) => o.tripId === tripId).flatMap((o) => o.driverIds);
  }
}

export class FakeCaps implements CapsPort {
  readonly over = new Set<string>();

  async isOverCap(driverId: string): Promise<boolean> {
    return this.over.has(driverId);
  }
}

export class FakeDepartures implements DeparturesPort {
  readonly seats = new Map<string, number>();

  readonly cancelled: string[] = [];

  async seatsFilled(departureId: string): Promise<number | null> {
    return this.seats.get(departureId) ?? null;
  }

  async cancelLowFill(departureId: string): Promise<void> {
    this.cancelled.push(departureId);
  }
}
