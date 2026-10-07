import type { DeliveryPoint, VehicleClass, Vertical } from '@driver/contracts';

/**
 * Narrow ports dispatch consumes from other modules. Dispatch owns the offer lifecycle; the owning
 * modules implement these and are bound in `dispatch.module.ts` (trips: `TripsServiceTripOffers`;
 * ledger: its `CAPS_PORT`; departures: the routes module's `RoutesDeparturesPort`).
 */

/** What dispatch needs to build the courier trip of a merchant order (auto-assign). */
export interface CourierTripInput {
  orderId: string;
  cityId: string;
  vertical: Vertical;
  minVehicleClass: VehicleClass | null;
  pickup: DeliveryPoint;
  dropoff: DeliveryPoint;
}

/** A ride's trip: the rider's pickup and drop-off, in the ride's own vertical. */
export interface RideTripInput {
  orderId: string;
  cityId: string;
  vertical: 'taxi' | 'tuktuk';
  pickup: DeliveryPoint;
  dropoff: DeliveryPoint;
  quoteId: string | null;
}

/** Trips: create the courier trip, tell it it was offered / assigned, and how each offer ended. */
export interface TripOffersPort {
  /** Idempotent: an order already on a live trip returns that trip. */
  createCourierTrip(input: CourierTripInput): Promise<string>;
  /** The live trip carrying this order, if any (the kitchen's "ready" finds the courier request through it). */
  liveTripFor?(orderId: string): Promise<string | null>;
  /** Idempotent: a ride already on a live trip returns that trip. */
  createRideTrip?(input: RideTripInput): Promise<string>;
  offer(tripId: string, driverIds: string[], timeoutSec: number): Promise<void>;
  assign(tripId: string, driverId: string, opts?: { compensationIqd?: number; batchWith?: string[]; vehicleClass?: VehicleClass }): Promise<void>;
  /** The driver said no; `othersPending`: other offers on this trip are still open. */
  decline(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void>;
  /** The driver's offer ran out without an answer. */
  timeout(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void>;
}
export const TRIP_OFFERS = Symbol('TRIP_OFFERS');

/** Cash the job will put in the driver's hand that is not his (money §4, decisions §3). */
export interface JobExposure {
  valueIqd: number;
  prepaid: boolean;
}

/**
 * Ledger (money & ops §4, G-80): caps by role and tier. Over cap = finish the current job, no new
 * offers; a cash job must also fit under the cap (or be a single job worth ≤ 50 % of it).
 */
export interface CapsPort {
  isOverCap(driverId: string): Promise<boolean>;
  canOffer(driverId: string, job?: JobExposure): Promise<boolean>;
}
export const CAPS = Symbol('CAPS');

/** Routes (intercity departures): seats sold incl. walk-ups, and the low-fill cancel. */
export interface DeparturesPort {
  /** Seats filled including walk-ups; null when the departure is unknown. */
  seatsFilled(departureId: string): Promise<number | null>;
  /** False (when the owner says so) = the rule does not hold yet; nothing was cancelled. */
  cancelLowFill(departureId: string): Promise<void | boolean>;
  /** When the low-fill rule may cancel the departure (decision 2026-10-04: T−10, or the latest departure when announced < 30 min ahead). */
  lowFillCheckAt?(departureId: string): Promise<Date | null>;
}
export const DEPARTURES = Symbol('DEPARTURES');

/**
 * Launch kill switches with "hold dispatch" (`modules/controls`): a new job in a held vertical or zone
 * gets no automatic offers; it goes to the dispatcher as suggest-only. Optional (harnesses run without it).
 */
export interface DispatchHoldsPort {
  dispatchHeld(job: { cityId: string; vertical: Vertical; zoneId: string }): Promise<boolean>;
}

export const DISPATCH_HOLDS = Symbol('DISPATCH_HOLDS');

/**
 * What a rider asked of his rides (ride step 3), from the ride-habits module (bound at runtime: that
 * module imports this one): the drivers he keeps off his rides (s5), his favourites (s4), and for the
 * «عوائل» first wave (s6) each driver's public rating and since when he drives here.
 */
export interface RiderPrefsPort {
  avoided(personId: string): Promise<string[]>;
  favourites(personId: string): Promise<string[]>;
  standing(driverIds: readonly string[]): Promise<Map<string, { rating: number | null; driverSince: Date | null }>>;
}

// ───────────────────────── fakes for tests and the simulator ─────────────────────────

export class FakeTripOffers implements TripOffersPort {
  readonly offers: Array<{ tripId: string; driverIds: string[]; timeoutSec: number }> = [];

  readonly assigns: Array<{ tripId: string; driverId: string; compensationIqd: number; batchWith: string[] }> = [];

  readonly vehicles: Array<{ tripId: string; driverId: string; vehicleClass: VehicleClass | undefined }> = [];

  readonly outcomes: Array<{ kind: 'decline' | 'timeout'; tripId: string; driverId: string; othersPending: boolean }> = [];

  readonly created: CourierTripInput[] = [];

  /** Makes the next `assign` throw (e.g. trips refusing a vehicle that is too small). */
  failAssign: Error | null = null;

  async createCourierTrip(input: CourierTripInput): Promise<string> {
    this.created.push(input);
    return `trip-${input.orderId}`;
  }

  async liveTripFor(orderId: string): Promise<string | null> {
    return this.created.some((c) => c.orderId === orderId) || this.rides.some((c) => c.orderId === orderId) ? `trip-${orderId}` : null;
  }

  readonly rides: RideTripInput[] = [];

  async createRideTrip(input: RideTripInput): Promise<string> {
    if (!this.rides.some((r) => r.orderId === input.orderId)) this.rides.push(input);
    return `trip-${input.orderId}`;
  }

  async offer(tripId: string, driverIds: string[], timeoutSec: number): Promise<void> {
    this.offers.push({ tripId, driverIds: [...driverIds], timeoutSec });
  }

  async assign(tripId: string, driverId: string, opts: { compensationIqd?: number; batchWith?: string[]; vehicleClass?: VehicleClass } = {}): Promise<void> {
    if (this.failAssign) {
      const err = this.failAssign;
      this.failAssign = null;
      throw err;
    }
    this.assigns.push({ tripId, driverId, compensationIqd: opts.compensationIqd ?? 0, batchWith: opts.batchWith ?? [] });
    this.vehicles.push({ tripId, driverId, vehicleClass: opts.vehicleClass });
  }

  async decline(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void> {
    this.outcomes.push({ kind: 'decline', tripId, driverId, othersPending: opts.othersPending });
  }

  async timeout(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void> {
    this.outcomes.push({ kind: 'timeout', tripId, driverId, othersPending: opts.othersPending });
  }

  /** Every driver ever offered this trip, in order. */
  offeredTo(tripId: string): string[] {
    return this.offers.filter((o) => o.tripId === tripId).flatMap((o) => o.driverIds);
  }
}

export class FakeCaps implements CapsPort {
  readonly over = new Set<string>();

  /** Cap room left per driver; absent = unlimited. */
  readonly remaining = new Map<string, number>();

  readonly asked: Array<{ driverId: string; job: JobExposure | undefined }> = [];

  async isOverCap(driverId: string): Promise<boolean> {
    return this.over.has(driverId);
  }

  async canOffer(driverId: string, job?: JobExposure): Promise<boolean> {
    this.asked.push({ driverId, job });
    if (this.over.has(driverId)) return false;
    if (!job || job.prepaid) return true;
    return job.valueIqd <= (this.remaining.get(driverId) ?? Number.POSITIVE_INFINITY);
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
