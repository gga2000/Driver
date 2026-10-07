import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  START_CODE_RULES,
  type Actor,
  type ArriveStopInput,
  type CancelTripInput,
  type CompleteStopInput,
  type FailTripInput,
  type ReportPositionInput,
  type ReportPositionsInput,
  type ReportPositionOutput,
  type RoleKind,
  type RunSheet,
  type SkipStopInput,
  type StartCodeAlert,
  type StartCodeAlertsInput,
  type StartUnreachableInput,
  type Trip,
  type TripsPort,
} from '@driver/contracts';
import { shortDisplayName } from '../identity/index.js';
import { TripsService } from './trips.service.js';

/** The slice of identity the trips transport needs: live role checks. */
export interface RoleChecker {
  hasRole(personId: string, kind: RoleKind): Promise<boolean>;
}

export const TRIPS_ROLE_CHECKER = Symbol('TRIPS_ROLE_CHECKER');

/**
 * Identity's narrow port for children's names (M2 review follow-up): names live only in the vault;
 * identity reads them for this driver and logs every read. Bound to `IdentityService`.
 */
export interface ChildNamesPort {
  childNamesForRunSheet(driverId: string, childRefs: readonly string[]): Promise<Record<string, string>>;
}

export const TRIPS_CHILD_NAMES = Symbol('TRIPS_CHILD_NAMES');

/**
 * Identity's driver cards for the Console's code alerts (s1): name and masked number of each driver,
 * one logged vault read per driver for the staff member asking. Bound to `IdentityService`.
 */
export interface DriverCardsPort {
  memberCards(personIds: readonly string[], accessorId: string, purpose?: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
}

export const TRIPS_DRIVER_CARDS = Symbol('TRIPS_DRIVER_CARDS');

const OPS: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

/**
 * `TripsPort` for the tRPC router: maps the authenticated actor onto `TripsService` and decides
 * who is acting — the trip's courier, or a dispatcher (fail from 3:00, platform cancel). Accepting
 * or declining is not here: drivers answer offers through `dispatch.respond` only.
 */
@Injectable()
export class TripsRpc implements TripsPort {
  constructor(
    private readonly trips: TripsService,
    @Inject(TRIPS_ROLE_CHECKER) private readonly roles: RoleChecker,
    @Inject(TRIPS_CHILD_NAMES) private readonly childNames: ChildNamesPort,
    /** The Console code alerts' driver names; without it they show the role only. */
    @Optional() @Inject(TRIPS_DRIVER_CARDS) private readonly cards: DriverCardsPort | null = null,
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

  /** Only the trip's own driver gets the children's names, and only through identity (each read logged). */
  async runSheet(actor: Actor, input: { tripId: string }): Promise<RunSheet> {
    const trip = await this.trips.get(input.tripId);
    if (!trip.courierId || trip.courierId !== actor.personId) throw new DriverError('forbidden');
    const refs = [...new Set(trip.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r)))];
    const names = refs.length > 0 ? await this.childNames.childNamesForRunSheet(actor.personId, refs) : {};
    return {
      tripId: trip.id,
      stops: trip.stops.map((s) => ({ stopId: s.id, seq: s.seq, type: s.type, zoneKey: s.zoneKey, state: s.state, childRef: s.childRef, childName: s.childRef ? (names[s.childRef] ?? null) : null })),
    };
  }

  reportPosition(actor: Actor, input: ReportPositionInput): Promise<ReportPositionOutput> {
    return this.trips.reportDevicePositions(actor.personId, [input], input.tripId);
  }

  reportPositions(actor: Actor, input: ReportPositionsInput): Promise<ReportPositionOutput> {
    return this.trips.reportDevicePositions(actor.personId, input.fixes);
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

  /**
   * s1: the city's night-ride code alerts of the last `START_CODE_RULES.alertShowMin`, newest first —
   * the pickup where `wrongAlertAt` wrong codes were typed, the driver (a logged vault read for the
   * staff member asking) and whether the rider got in afterwards. Never the code.
   */
  async startCodeAlerts(actor: Actor, input: StartCodeAlertsInput): Promise<StartCodeAlert[]> {
    const rows = await this.trips.startCodeAlerts(input.cityId, START_CODE_RULES.alertShowMin);
    if (rows.length === 0) return [];
    const drivers = [...new Set(rows.map((r) => r.trip.courierId).filter((id): id is string => id !== null))];
    const cards = this.cards && drivers.length > 0 ? await this.cards.memberCards(drivers, actor.personId, 'ride_start_code_alert') : {};
    return rows.flatMap(({ stop, trip }) => {
      if (!trip.courierId || !stop.orderId || !stop.startCodeAlertAt) return [];
      const card = cards[trip.courierId];
      return [
        {
          alertId: stop.id,
          cityId: trip.cityId,
          orderId: stop.orderId,
          tripId: trip.id,
          vertical: trip.vertical,
          driver: { personId: trip.courierId, displayName: card?.name ? shortDisplayName(card.name) || null : null, phoneMasked: card?.phoneMasked ?? null },
          wrongCount: stop.startCodeWrong,
          raisedAt: stop.startCodeAlertAt,
          startedAt: stop.state === 'completed' ? stop.completedAt : null,
        },
      ];
    });
  }

  private async any(actor: Actor, kinds: readonly RoleKind[]): Promise<boolean> {
    for (const k of kinds) if (await this.roles.hasRole(actor.personId, k)) return true;
    return false;
  }
}
