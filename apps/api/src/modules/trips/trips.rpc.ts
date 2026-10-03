import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  type AcceptTripInput,
  type Actor,
  type ArriveStopInput,
  type CancelTripInput,
  type CompleteStopInput,
  type DeclineTripInput,
  type FailTripInput,
  type ReportPositionInput,
  type ReportPositionOutput,
  type RoleKind,
  type SkipStopInput,
  type StartUnreachableInput,
  type Trip,
  type TripsPort,
} from '@driver/contracts';
import { TripsService } from './trips.service.js';

/** The slice of identity the trips transport needs: live role checks. */
export interface RoleChecker {
  hasRole(personId: string, kind: RoleKind): Promise<boolean>;
}

export const TRIPS_ROLE_CHECKER = Symbol('TRIPS_ROLE_CHECKER');

const OPS: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

/**
 * `TripsPort` for the tRPC router: maps the authenticated actor onto `TripsService` and decides
 * who is acting — the trip's courier, or a dispatcher (fail from 3:00, platform cancel).
 */
@Injectable()
export class TripsRpc implements TripsPort {
  constructor(
    private readonly trips: TripsService,
    @Inject(TRIPS_ROLE_CHECKER) private readonly roles: RoleChecker,
  ) {}

  async get(actor: Actor, input: { tripId: string }): Promise<Trip> {
    const trip = await this.trips.get(input.tripId);
    if (trip.courierId !== actor.personId && !(await this.any(actor, OPS))) throw new DriverError('forbidden');
    return trip;
  }

  mine(actor: Actor): Promise<Trip[]> {
    return this.trips.forDriver(actor.personId);
  }

  board(_actor: Actor, input: { cityId: string }): Promise<Trip[]> {
    return this.trips.active(input.cityId);
  }

  accept(actor: Actor, input: AcceptTripInput): Promise<Trip> {
    return this.trips.accept(input.tripId, actor.personId, input);
  }

  decline(actor: Actor, input: DeclineTripInput): Promise<Trip> {
    return this.trips.decline(input.tripId, actor.personId, { reason: input.reason });
  }

  reportPosition(actor: Actor, input: ReportPositionInput): Promise<ReportPositionOutput> {
    return this.trips.reportPosition(actor.personId, input);
  }

  arrive(actor: Actor, input: ArriveStopInput): Promise<Trip> {
    return this.trips.arrive(input.tripId, input.stopId, actor.personId, input);
  }

  completeStop(actor: Actor, input: CompleteStopInput): Promise<Trip> {
    return this.trips.completeStop(input.tripId, input.stopId, actor.personId, input);
  }

  skipStop(actor: Actor, input: SkipStopInput): Promise<Trip> {
    return this.trips.skipStop(input.tripId, input.stopId, actor.personId, input.reason, input);
  }

  startUnreachable(actor: Actor, input: StartUnreachableInput): Promise<Trip> {
    return this.trips.startUnreachable(input.tripId, input.stopId, actor.personId, input);
  }

  async fail(actor: Actor, input: FailTripInput): Promise<Trip> {
    const trip = await this.trips.get(input.tripId);
    if (trip.courierId === actor.personId) return this.trips.fail(input.tripId, { personId: actor.personId, role: 'driver' }, input.reason);
    if (await this.roles.hasRole(actor.personId, 'dispatcher')) return this.trips.fail(input.tripId, { personId: actor.personId, role: 'dispatcher' }, input.reason);
    throw new DriverError('forbidden');
  }

  async cancel(actor: Actor, input: CancelTripInput): Promise<Trip> {
    const trip = await this.trips.get(input.tripId);
    if (trip.courierId === actor.personId) return this.trips.cancel(input.tripId, 'driver', actor.personId, input.reason);
    if (await this.any(actor, ['dispatcher', 'admin'])) return this.trips.cancel(input.tripId, 'platform', actor.personId, input.reason);
    throw new DriverError('forbidden');
  }

  private async any(actor: Actor, kinds: readonly RoleKind[]): Promise<boolean> {
    for (const k of kinds) if (await this.roles.hasRole(actor.personId, k)) return true;
    return false;
  }
}
