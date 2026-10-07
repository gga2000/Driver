import { Logger } from '@nestjs/common';
import { isDriverError, type Trip, type VehicleClass } from '@driver/contracts';
import type { CreateTripInput, TripsService } from '../trips/index.js';
import type { CourierTripInput, RideTripInput, TripOffersPort } from './ports.js';

/** The slice of `TripsService` dispatch drives. */
export type TripsForDispatch = Pick<TripsService, 'activeForOrder' | 'createForOrders' | 'offer' | 'accept' | 'decline' | 'timeout' | 'forDriver'>;

/**
 * `TripOffersPort` over the trips module's public service. Dispatch owns offers and timers; trips
 * owns the trip's state and emits `trip.offered/accepted/declined/timed_out` from these calls.
 *
 * Offer outcomes (decline, timeout) and re-offers race with cancellations by design (the customer
 * may cancel while a wave is open): a `trip_state_conflict` there means the trip has moved on, and
 * dispatch hears about it through `trip.cancelled`, so it is logged and ignored. Assignment never
 * swallows errors: if trips refuses (vehicle too small, trip gone) the driver must not be told he won.
 */
export class TripsServiceTripOffers implements TripOffersPort {
  private readonly logger = new Logger(TripsServiceTripOffers.name);

  constructor(private readonly trips: TripsForDispatch) {}

  async createCourierTrip(input: CourierTripInput): Promise<string> {
    const live = await this.trips.activeForOrder(input.orderId);
    if (live) return live.id;
    const trip: CreateTripInput = {
      cityId: input.cityId,
      vertical: input.vertical,
      orders: [{ orderId: input.orderId, minVehicleClass: input.minVehicleClass }],
      stops: [
        { orderId: input.orderId, type: 'pickup', zoneKey: input.pickup.zoneKey, target: input.pickup.pin ?? null },
        { orderId: input.orderId, type: 'dropoff', zoneKey: input.dropoff.zoneKey, target: input.dropoff.door ?? input.dropoff.pin ?? null, placeId: input.dropoff.placeId ?? null },
      ],
    };
    return (await this.trips.createForOrders(trip)).id;
  }

  async createRideTrip(input: RideTripInput): Promise<string> {
    const live = await this.trips.activeForOrder(input.orderId);
    if (live) return live.id;
    const trip: CreateTripInput = {
      cityId: input.cityId,
      vertical: input.vertical,
      quoteId: input.quoteId,
      orders: [{ orderId: input.orderId }],
      stops: [
        { orderId: input.orderId, type: 'pickup', zoneKey: input.pickup.zoneKey, target: input.pickup.pin ?? null },
        { orderId: input.orderId, type: 'dropoff', zoneKey: input.dropoff.zoneKey, target: input.dropoff.door ?? input.dropoff.pin ?? null, placeId: input.dropoff.placeId ?? null },
      ],
    };
    return (await this.trips.createForOrders(trip)).id;
  }

  async jobOrder(driverId: string): Promise<string[]> {
    return (await this.trips.forDriver(driverId)).map((t) => t.id);
  }

  async liveTripFor(orderId: string): Promise<string | null> {
    return (await this.trips.activeForOrder(orderId))?.id ?? null;
  }

  async offer(tripId: string, driverIds: string[]): Promise<void> {
    await this.tolerant(`offer ${tripId}`, () => this.trips.offer(tripId, { driverIds }));
  }

  async assign(tripId: string, driverId: string, opts: { vehicleClass?: VehicleClass } = {}): Promise<void> {
    // Dispatch already applied its one-job / batching rules (offer.orchestrator `fitsCurrentJobs`).
    await this.trips.accept(tripId, driverId, { vehicleClass: opts.vehicleClass ?? 'car' }, { assignedByDispatch: true });
  }

  async decline(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void> {
    await this.tolerant(`decline ${tripId}/${driverId}`, () => this.trips.decline(tripId, driverId, { othersPending: opts.othersPending }));
  }

  async timeout(tripId: string, driverId: string, opts: { othersPending: boolean }): Promise<void> {
    await this.tolerant(`timeout ${tripId}/${driverId}`, () => this.trips.timeout(tripId, { driverId, othersPending: opts.othersPending }));
  }

  private async tolerant(what: string, fn: () => Promise<Trip>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (isDriverError(err) && err.code === 'trip_state_conflict') {
        this.logger.debug(`${what}: trip already moved on`);
        return;
      }
      throw err;
    }
  }
}
