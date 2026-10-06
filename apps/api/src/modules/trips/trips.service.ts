import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  NEAR_DROPOFF_M,
  encodeDomainEvent,
  isDomainEventType,
  type DeviceFix,
  type HandoverProof,
  type LatLng,
  type ReportPositionOutput,
  type Stop,
  type Trip,
  type TripState,
  type VehicleClass,
  type Vertical,
} from '@driver/contracts';
import { HANDOVER_PHOTOS, type HandoverPhotos } from './handover-photos.js';
import { pickupCodeFor } from '../../shared/pickup-code.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { localDateKey } from '../../shared/local-time.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import { TRIP_EVENTS, type TripEventEmitter } from './events.adapter.js';
import { GEOFENCE_RADIUS_M, evaluateArrival, haversineMeters } from './geofence.js';
import { assessFix } from './position-guard.js';
import { SuspicionCounter, type SuspicionReason } from './position-suspicion.js';
import { DenyAllOfferCheck, type TripOfferCheck } from './offer-check.port.js';
import { NoChangeToWallet, type TripHandoverCheck } from './handover-check.port.js';
import { childHandover, isStopFinished } from './stops.js';
import { OFFER_STATES, PROGRESS_STATES, TripTransitionError, deriveTripState, isTerminal, transition, tripEventType } from './trip.machine.js';
import { TRIPS_REPOSITORY, type NewStop, type StopRecord, type TrailPointRecord, type TripOrderRecord, type TripRecord, type TripsRepository } from './trips.repository.js';
import {
  UNREACHABLE_ESCALATE_AFTER_MS,
  UNREACHABLE_FAIL_AFTER_MS,
  UNREACHABLE_EXTEND_MS,
  failAt,
  UNREACHABLE_JOBS,
  canFail,
  unreachableJobId,
  unreachableStatus,
  type FailRole,
} from './unreachable.js';

export const TRIPS_QUEUE = Symbol('TRIPS_QUEUE');

/** Edge-case review B.24: no driver update for 10 min while inside the dropoff geofence → server completes the ride. */
export const RIDE_AUTOCOMPLETE_AFTER_MS = 10 * 60_000;
const RIDE_VERTICALS: readonly Vertical[] = ['taxi', 'tuktuk'];
const SYSTEM = 'system';

export type TripTimerJob =
  | { tripId: string; stopId: string | null; startedAtMs: number }
  | { tripId: string; positionAtMs: number };

export const TRIP_JOBS = { ...UNREACHABLE_JOBS, rideAutoComplete: 'ride.autoComplete' } as const;

/** Vehicle classes ranked by what they can carry (edge-case review A.16). Intercity cars carry like a car. */
const VEHICLE_RANK: Record<VehicleClass, number> = { bike: 0, tuktuk: 1, car: 2, intercity: 2, suv: 3, van: 4 };

export function vehicleFits(vehicle: VehicleClass, required: VehicleClass | null): boolean {
  return required === null || VEHICLE_RANK[vehicle] >= VEHICLE_RANK[required];
}

export function largestVehicleClass(classes: ReadonlyArray<VehicleClass | null>): VehicleClass | null {
  let best: VehicleClass | null = null;
  for (const c of classes) if (c && (best === null || VEHICLE_RANK[c] > VEHICLE_RANK[best])) best = c;
  return best;
}

export interface TripOrderInput {
  orderId: string;
  /** Smallest vehicle class that may carry this order (orders computes it from the cap table). */
  minVehicleClass?: VehicleClass | null;
}

export interface CreateTripInput {
  cityId: string;
  vertical: Vertical;
  orders: TripOrderInput[];
  stops: NewStop[];
  quoteId?: string | null;
  batchId?: string | null;
  routeId?: string | null;
  departureId?: string | null;
}

/** Device evidence on a driver tap (edge-case §10). */
export interface DeviceStamp {
  occurredAt?: Date | undefined;
  deviceUptimeMs?: number | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * Trips (plan Step 4): the logistics object. Every courier or driver job is a Trip with ordered
 * Stops; once accepted, the trip's state is derived from its stops. Arrival is armed by the 60 m
 * geofence and recorded at server receipt time; a tap outside is flagged, never blocked. The
 * unreachable protocol runs on delayed queue jobs. Orders hang off trips through `trip_orders`
 * with full attach/detach history (the events module reads `detachedAt` to quarantine late replays).
 *
 * Every mutation runs in one unit of work and emits its domain events through the adapter.
 */
@Injectable()
export class TripsService implements OnModuleInit {
  private readonly positionListeners = new Set<(report: PositionReport) => void>();
  /** Fake-GPS and jump counts per driver per day (maps program SP4a). */
  private readonly suspicion = new SuspicionCounter();

  constructor(
    @Inject(TRIPS_REPOSITORY) private readonly repo: TripsRepository,
    @Inject(TRIP_EVENTS) private readonly events: TripEventEmitter,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TRIPS_QUEUE) private readonly queue: Queue<TripTimerJob>,
    @Optional() @Inject(HANDOVER_PHOTOS) private readonly photos?: HandoverPhotos,
  ) {}

  /** Dispatch's open-offer check (M2 review follow-up); fail closed until dispatch binds it. */
  private offerCheck: TripOfferCheck = new DenyAllOfferCheck();

  onModuleInit(): void {
    this.queue.process((job) => this.handleTimer(job.name, job.data));
  }

  /**
   * Dispatch binds its `DispatchOffer` check here at start-up (dispatch imports trips, so trips cannot
   * inject it). Accept and decline are internal: the only public path is `dispatch.respond`.
   */
  bindOfferCheck(check: TripOfferCheck): void {
    this.offerCheck = check;
  }

  /** "الخردة علينا": the orders module's check of a drop-off's cash; until bound, no change-to-wallet passes. */
  private handoverCheck: TripHandoverCheck = new NoChangeToWallet();

  /** Orders binds its hand-over check here at start-up (orders imports trips, so trips cannot inject it). */
  bindHandoverCheck(check: TripHandoverCheck): void {
    this.handoverCheck = check;
  }

  private async assertOpenOffer(tripId: string, driverId: string, intent: 'accept' | 'decline'): Promise<void> {
    const verdict = await this.offerCheck.check(tripId, driverId, intent);
    if (verdict !== 'ok') throw new DriverError(verdict);
  }

  // ───────────────────────── creation and order links ─────────────────────────

  async createForOrders(input: CreateTripInput, actorId = SYSTEM): Promise<Trip> {
    const orderIds = new Set(input.orders.map((o) => o.orderId));
    for (const s of input.stops) if (s.orderId && !orderIds.has(s.orderId)) throw new DriverError('invalid_input');
    if (input.stops.length === 0) throw new DriverError('invalid_input');
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      for (const o of input.orders) await this.assertNotOnActiveTrip(o.orderId, tx);
      const trip = await this.repo.createTrip(
        { cityId: input.cityId, vertical: input.vertical, quoteId: input.quoteId ?? null, batchId: input.batchId ?? null, routeId: input.routeId ?? null, departureId: input.departureId ?? null },
        now,
        tx,
      );
      for (const o of input.orders) {
        await this.repo.attach({ tripId: trip.id, orderId: o.orderId, at: now, reason: 'created', changedBy: personOrNull(actorId), minVehicleClass: o.minVehicleClass ?? null }, tx);
      }
      await this.repo.addStops(trip.id, input.stops, now, tx);
      await this.emit(tx, 'trip.created', actorId, trip.id, { vertical: trip.vertical, cityId: trip.cityId, orderIds: [...orderIds], stopCount: input.stops.length });
      return this.view(trip.id, tx);
    });
  }

  /** Batches another order onto a trip (dispatch §3) — its stops are appended; history is kept. */
  async attachOrder(tripId: string, order: TripOrderInput & { stops: NewStop[] }, actorId = SYSTEM, reason = 'batched'): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      if (isTerminal(trip.state)) throw new DriverError('trip_state_conflict');
      const links = await this.repo.linksOf(tripId, tx);
      if (links.some((l) => l.orderId === order.orderId && l.detachedAt === null)) return this.view(tripId, tx);
      await this.assertNotOnActiveTrip(order.orderId, tx);
      const now = this.clock.now();
      await this.repo.attach({ tripId, orderId: order.orderId, at: now, reason, changedBy: personOrNull(actorId), minVehicleClass: order.minVehicleClass ?? null }, tx);
      await this.repo.addStops(tripId, order.stops.map((s) => ({ ...s, orderId: s.orderId ?? order.orderId })), now, tx);
      await this.emit(tx, 'trip.batched', actorId, tripId, { orderId: order.orderId, reason }, { orderId: order.orderId });
      await this.rederive(trip, actorId, tx);
      return this.view(tripId, tx);
    });
  }

  /**
   * Takes an order off a trip (re-batching, reassignment, cancellation, merchant release). Its
   * unfinished stops are skipped; a trip left with no orders is cancelled by the platform.
   * Idempotent: detaching an order that is not attached is a no-op.
   */
  async detachOrder(tripId: string, orderId: string, actorId = SYSTEM, reason = 'reassigned'): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      const links = await this.repo.linksOf(tripId, tx);
      const link = links.find((l) => l.orderId === orderId && l.detachedAt === null);
      if (!link) return this.view(tripId, tx);
      const now = this.clock.now();
      await this.repo.detach(link.id, { at: now, reason, changedBy: personOrNull(actorId) }, tx);
      for (const s of await this.repo.stopsOf(tripId, tx)) {
        if (s.orderId === orderId && !isStopFinished(s.state)) await this.repo.updateStop(s.id, { state: 'skipped', skippedAt: now, skipReason: `detached:${reason}` }, now, tx);
      }
      await this.emit(tx, 'trip.order_detached', actorId, tripId, { orderId, reason }, { orderId });
      const remaining = links.filter((l) => l.detachedAt === null && l.id !== link.id);
      if (remaining.length === 0 && !isTerminal(trip.state)) {
        await this.finishCancelled(trip, 'platform_cancelled', actorId, 'all_orders_detached', tx);
      } else {
        await this.rederive(trip, actorId, tx);
      }
      return this.view(tripId, tx);
    });
  }

  // ───────────────────────── offer loop ─────────────────────────

  /** Puts the trip on offer (first wave or a re-offer after a decline/timeout). */
  async offer(tripId: string, opts: { driverIds?: string[]; wave?: number } = {}, actorId = SYSTEM): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      if (!OFFER_STATES.includes(trip.state)) throw new DriverError('trip_state_conflict');
      const now = this.clock.now();
      await this.move(trip, 'offered', actorId, tx, { offeredAt: now }, { driverIds: opts.driverIds ?? [], wave: opts.wave ?? 1 }, true);
      return this.view(tripId, tx);
    });
  }

  /**
   * Internal — called by dispatch's port only (`TripsServiceTripOffers.assign`, from `dispatch.respond`).
   * The driver must hold an open offer for this trip in dispatch's records, and must not be over cap
   * (M2 review follow-up: `offer_not_found` / `offer_not_yours` / `over_cap`). First valid accept wins
   * (dispatch's SET NX lock; the conditional state update here is the database-level guard).
   * Replaying the same driver's accept is a no-op. The vehicle must meet the largest order cap on the
   * trip (edge-case review A.16). A driver already on a trip is refused unless dispatch made the
   * assignment (`assignedByDispatch`, after its batching rules).
   */
  async accept(
    tripId: string,
    driverId: string,
    input: { vehicleClass: VehicleClass; vehicleId?: string | undefined } & DeviceStamp,
    opts: { assignedByDispatch?: boolean } = {},
  ): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      if (trip.courierId === driverId && (PROGRESS_STATES.includes(trip.state) || trip.state === 'completed')) return this.view(tripId, tx);
      await this.assertOpenOffer(tripId, driverId, 'accept');
      if (trip.state !== 'offered') throw new DriverError('trip_state_conflict');
      // Review H: one driver, one job. Only dispatch may hand a busy driver a second trip, after its
      // own batching check (`fitsCurrentJobs` / dispatcher override); a direct accept never can.
      if (!opts.assignedByDispatch) {
        const holding = (await this.repo.findTrips({ courierId: driverId, states: PROGRESS_STATES }, tx)).filter((t) => t.id !== tripId);
        if (holding.length > 0) throw new DriverError('offer_conflicts_current_job');
      }
      const links = (await this.repo.linksOf(tripId, tx)).filter((l) => l.detachedAt === null);
      if (!vehicleFits(input.vehicleClass, largestVehicleClass(links.map((l) => l.minVehicleClass)))) throw new DriverError('vehicle_too_small');
      const now = this.clock.now();
      const accepted = await this.move(
        trip,
        'accepted',
        driverId,
        tx,
        { courierId: driverId, vehicleId: input.vehicleId ?? null, acceptedAt: now },
        { driverId, vehicleClass: input.vehicleClass, orderIds: links.map((l) => l.orderId) },
        false,
        input,
      );
      await this.move(accepted, 'en_route_to_pickup', driverId, tx, {}, { driverId, orderIds: links.map((l) => l.orderId) });
      return this.view(tripId, tx);
    });
  }

  /**
   * Internal — dispatch's port only. A driver declined an offer he holds (checked against dispatch's
   * records like `accept`). With other offers still open (`othersPending`, from dispatch) the trip
   * stays `offered` and only the event is recorded; otherwise it moves to `declined` until re-offered.
   */
  async decline(tripId: string, driverId: string, opts: { reason?: string | undefined; othersPending?: boolean } = {}): Promise<Trip> {
    await this.assertOpenOffer(tripId, driverId, 'decline');
    return this.offerOutcome(tripId, driverId, 'declined', opts.othersPending ?? false, { reason: opts.reason ?? null });
  }

  async timeout(tripId: string, opts: { driverId?: string; othersPending?: boolean } = {}): Promise<Trip> {
    return this.offerOutcome(tripId, opts.driverId ?? SYSTEM, 'timed_out', opts.othersPending ?? false, {});
  }

  private async offerOutcome(tripId: string, driverId: string, to: 'declined' | 'timed_out', othersPending: boolean, extra: Record<string, unknown>): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      if (trip.state === to) return this.view(tripId, tx);
      if (trip.state !== 'offered') throw new DriverError('trip_state_conflict');
      if (othersPending) {
        await this.emit(tx, tripEventType(to), driverId, tripId, { driverId, from: 'offered', to: 'offered', othersPending: true, ...extra });
      } else {
        await this.move(trip, to, driverId, tx, {}, { driverId, ...extra });
      }
      return this.view(tripId, tx);
    });
  }

  // ───────────────────────── positions and stops ─────────────────────────

  /**
   * Stores the position in the trail (not the events table — domain §6) and arms every unfinished
   * stop within 60 m: the first entry records `geofenceEnteredAt` and emits `stop.geofence_entered`.
   */
  async reportPosition(driverId: string, input: { tripId?: string | undefined; pin: LatLng; at: Date; speedKmh?: number | undefined; bearing?: number | undefined; accuracyM?: number | undefined }): Promise<ReportPositionOutput> {
    let tripIds: string[] = [];
    const out = await this.reportPositionTx(driverId, input, (ids) => (tripIds = ids));
    // After the commit: observers (the live channel) see the fix. Positions are not domain events (domain §6).
    if (this.positionListeners.size > 0) {
      const report: PositionReport = { driverId, pin: input.pin, at: input.at, bearing: input.bearing ?? null, speedKmh: input.speedKmh ?? null, tripIds };
      for (const l of [...this.positionListeners]) {
        try {
          l(report);
        } catch {
          // an observer never fails the driver's report
        }
      }
    }
    return out;
  }

  /**
   * The device path (`trips.reportPosition` / `trips.reportPositions`, maps program SP4a): each fix is
   * judged by `assessFix` against the driver's last stored fix, oldest first. Refused fixes come back by
   * index; live ones go through `reportPosition` (geofences, auto-complete, live map); late replays are
   * stored as trail only. Fake GPS and impossible jumps are counted and, past the threshold, raised to
   * support as `driver.position_suspect` — never a penalty. The simulator and demo seeds call
   * `reportPosition` directly and are not judged.
   */
  async reportDevicePositions(driverId: string, fixes: readonly DeviceFix[], tripId?: string): Promise<ReportPositionOutput> {
    const ordered = fixes.map((fix, index) => ({ fix, index })).sort((a, b) => a.fix.at.getTime() - b.fix.at.getTime());
    const rejected: NonNullable<ReportPositionOutput['rejected']> = [];
    let armed: ReportPositionOutput['armed'] = [];
    const stored = await this.repo.lastTrailPoint({ driverId });
    let last: { at: Date; pin: LatLng } | null = stored ? { at: stored.at, pin: stored.pin } : null;
    for (const { fix, index } of ordered) {
      const now = this.clock.now();
      const verdict = assessFix(fix, last, now);
      if (verdict.kind === 'reject') {
        rejected.push({ index, reason: verdict.reason });
        if (verdict.reason === 'mocked') await this.noteSuspicion(driverId, 'mocked', fix.pin, now);
        continue;
      }
      const input = { tripId, pin: fix.pin, at: verdict.at, speedKmh: fix.speedKmh, bearing: fix.bearing, accuracyM: fix.accuracyM };
      if (verdict.live) armed = (await this.reportPosition(driverId, input)).armed;
      else await this.storeTrailOnly(driverId, input);
      if (verdict.jump) await this.noteSuspicion(driverId, 'jump', fix.pin, now);
      last = { at: verdict.at, pin: fix.pin };
    }
    rejected.sort((a, b) => a.index - b.index);
    return rejected.length > 0 ? { armed, rejected } : { armed };
  }

  /** A late replay (offline buffer): kept in the trail for history, never arms a geofence or reaches the live map. */
  private async storeTrailOnly(driverId: string, input: { tripId?: string | undefined; pin: LatLng; at: Date; speedKmh?: number | undefined; bearing?: number | undefined; accuracyM?: number | undefined }): Promise<void> {
    await this.uow.run(async (tx) => {
      const trips = input.tripId ? [await this.load(input.tripId, tx)] : await this.repo.findTrips({ courierId: driverId, states: PROGRESS_STATES }, tx);
      const point = { driverId, at: input.at, pin: input.pin, speedKmh: input.speedKmh ?? null, bearing: input.bearing ?? null, accuracyM: input.accuracyM ?? null };
      if (trips.length === 0) {
        await this.repo.addTrailPoint({ tripId: null, ...point }, tx);
        return;
      }
      for (const trip of trips) {
        if (trip.courierId !== driverId) throw new DriverError('not_trip_courier');
        await this.repo.addTrailPoint({ tripId: trip.id, ...point }, tx);
      }
    });
  }

  private async noteSuspicion(driverId: string, reason: SuspicionReason, pin: LatLng, now: Date): Promise<void> {
    const day = localDateKey(now);
    if (!this.suspicion.note(driverId, reason, day)) return;
    await this.events.emit(undefined, { type: 'driver.position_suspect', actorId: driverId, occurredAt: now, location: pin, payload: { driverId, reason, day } }, { name: 'driver', id: driverId });
  }

  /** One retention batch (decision D6): trail points older than `cutoff`, except `keepTripIds`'. */
  /** A trip's stored GPS trail, oldest first (the Console replay, maps program o2; 30 days). */
  trailOf(tripId: string): Promise<TrailPointRecord[]> {
    return this.repo.trailForTrip(tripId);
  }

  /** Every trip that ever carried this order, oldest link first (reassignments included). */
  async tripIdsForOrder(orderId: string): Promise<string[]> {
    const links = [...(await this.repo.linksForOrder(orderId))].sort((a, b) => a.attachedAt.getTime() - b.attachedAt.getTime());
    return [...new Set(links.map((l) => l.tripId))];
  }

  /** Pickups per zone of trips created in `[from, to)` (the driver map's forecast, maps program d5). */
  /** Completed drop-offs at a saved place outside this trip (maps program a5: first visit). */
  dropoffsAt(placeId: string, excludeTripId: string): Promise<number> {
    return this.repo.dropoffsAt(placeId, excludeTripId);
  }

  pickupsByZone(cityId: string, from: Date, to: Date): Promise<Map<string, number>> {
    return this.repo.pickupsByZone(cityId, from, to);
  }

  /**
   * The delivery photo of an order (maps program f11), as a short-lived signed URL for support; null
   * without one, after retention, or when photos are not wired.
   */
  async handoverPhotoUrl(orderId: string): Promise<string | null> {
    if (!this.photos) return null;
    for (const link of await this.repo.linksForOrder(orderId)) {
      const drop = (await this.repo.stopsOf(link.tripId)).find((s) => s.orderId === orderId && s.type === 'dropoff' && typeof s.handoverProof['photoUploadId'] === 'string');
      if (drop) return this.photos.readUrl(drop.handoverProof['photoUploadId'] as string);
    }
    return null;
  }

  /**
   * Deletes up to `batch` delivery photos of stops completed before `cutoff` (decision D6, 30 days):
   * the blob goes, the stop keeps `photoPurgedAt`. Returns how many went.
   */
  async purgeHandoverPhotos(cutoff: Date, batch: number): Promise<number> {
    if (!this.photos) return 0;
    const due = await this.repo.handoverPhotosBefore(cutoff, batch);
    const now = this.clock.now();
    for (const d of due) {
      await this.photos.remove(d.uploadId);
      const rest = Object.fromEntries(Object.entries(d.proof).filter(([k]) => k !== 'photoUploadId'));
      await this.repo.updateStop(d.stopId, { handoverProof: { ...rest, photoPurgedAt: now.toISOString() } }, now);
    }
    return due.length;
  }

  purgeTrail(cutoff: Date, keepTripIds: readonly string[], batch: number): Promise<number> {
    return this.repo.purgeTrail(cutoff, keepTripIds, batch);
  }

  /** Observes committed position reports (the live channel's courier positions and Console pins). */
  onPositionReported(listener: (report: PositionReport) => void): () => void {
    this.positionListeners.add(listener);
    return () => void this.positionListeners.delete(listener);
  }

  private async reportPositionTx(
    driverId: string,
    input: { tripId?: string | undefined; pin: LatLng; at: Date; speedKmh?: number | undefined; bearing?: number | undefined; accuracyM?: number | undefined },
    seen: (tripIds: string[]) => void,
  ): Promise<ReportPositionOutput> {
    return this.uow.run(async (tx) => {
      const trips = input.tripId ? [await this.load(input.tripId, tx)] : await this.repo.findTrips({ courierId: driverId, states: PROGRESS_STATES }, tx);
      seen(trips.map((t) => t.id));
      const armed: ReportPositionOutput['armed'] = [];
      const now = this.clock.now();
      if (trips.length === 0) {
        await this.repo.addTrailPoint({ tripId: null, driverId, at: input.at, pin: input.pin, speedKmh: input.speedKmh ?? null, bearing: input.bearing ?? null, accuracyM: input.accuracyM ?? null }, tx);
      }
      for (const trip of trips) {
        if (trip.courierId !== driverId) throw new DriverError('not_trip_courier');
        await this.repo.addTrailPoint({ tripId: trip.id, driverId, at: input.at, pin: input.pin, speedKmh: input.speedKmh ?? null, bearing: input.bearing ?? null, accuracyM: input.accuracyM ?? null }, tx);
        if (!PROGRESS_STATES.includes(trip.state)) continue;
        const stops = await this.repo.stopsOf(trip.id, tx);
        for (const s of stops) {
          if (isStopFinished(s.state) || !s.target) continue;
          const d = haversineMeters(input.pin, s.target);
          // "Almost there" (maps program SP5b): once per food drop-off, after its food is picked up.
          if (s.type === 'dropoff' && !s.courierNearAt && d <= NEAR_DROPOFF_M && !RIDE_VERTICALS.includes(trip.vertical) && pickedUpFor(stops, s.orderId)) {
            await this.repo.updateStop(s.id, { courierNearAt: input.at }, now, tx);
            await this.emit(tx, 'stop.courier_near', driverId, trip.id, { stopId: s.id, distanceM: Math.round(d) }, { orderId: s.orderId ?? undefined, occurredAt: input.at, location: input.pin });
          }
          if (d > GEOFENCE_RADIUS_M) continue;
          armed.push({ tripId: trip.id, stopId: s.id, distanceM: Math.round(d) });
          if (!s.geofenceEnteredAt) {
            await this.repo.updateStop(s.id, { geofenceEnteredAt: input.at }, now, tx);
            await this.emit(tx, 'stop.geofence_entered', driverId, trip.id, { stopId: s.id, stopType: s.type, distanceM: Math.round(d) }, { orderId: s.orderId ?? undefined, occurredAt: input.at, location: input.pin });
          }
        }
        if (RIDE_VERTICALS.includes(trip.vertical) && (trip.state === 'in_transit' || trip.state === 'arrived_dropoff')) {
          const lastDropoff = [...stops].reverse().find((s) => s.type === 'dropoff');
          if (lastDropoff?.target && haversineMeters(input.pin, lastDropoff.target) <= GEOFENCE_RADIUS_M) {
            const atMs = input.at.getTime();
            await this.queue.add(TRIP_JOBS.rideAutoComplete, { tripId: trip.id, positionAtMs: atMs }, { delayMs: RIDE_AUTOCOMPLETE_AFTER_MS, jobId: jobKey('trip', trip.id, 'autocomplete', atMs) });
          }
        }
      }
      return { armed };
    });
  }

  /**
   * The driver's "وصلت" tap — the official arrival. Recorded at server receipt time (edge-case
   * §10) with the device time on the event; the distance to the stop is stored and a tap outside
   * the 60 m geofence is flagged, never blocked. Replays are no-ops.
   */
  async arrive(tripId: string, stopId: string, driverId: string, arrival: { pin?: LatLng | undefined; accuracyM?: number | undefined } & DeviceStamp = {}): Promise<Trip> {
    const { accuracyM, ...input } = arrival;
    return this.uow.run(async (tx) => {
      const trip = await this.loadForCourier(tripId, driverId, tx);
      const stop = await this.stop(tripId, stopId, tx);
      if (stop.state !== 'pending') {
        if (stop.state === 'skipped') {
          if (await this.lateReplay(tx, trip, stop, 'stop.arrived', driverId, input, { stopId, stopType: stop.type, pin: input.pin ?? null, serverReceivedAt: this.clock.now().toISOString() })) return this.view(tripId, tx);
          throw new DriverError('stop_state_conflict');
        }
        return this.view(tripId, tx);
      }
      if (!PROGRESS_STATES.includes(trip.state)) throw new DriverError('trip_state_conflict');
      const now = this.clock.now();
      // Without a fix on the tap, his last trail point (and its own accuracy) stands in.
      const trail = input.pin ? null : await this.repo.lastTrailPoint({ tripId }, tx);
      const pin = input.pin ?? trail?.pin ?? null;
      // Only a fix sent with the tap carries an accuracy worth learning a door from (maps a3): his last
      // trail point may be minutes old after an offline replay.
      const arrivalAccuracyM = input.pin ? (accuracyM ?? null) : null;
      const { distanceM, outside } = evaluateArrival(pin, stop.target);
      await this.repo.updateStop(stop.id, { state: 'arrived', arrivedAt: now, arrivalPin: pin, arrivalDistanceM: distanceM, arrivalAccuracyM, arrivedOutsideGeofence: outside }, now, tx);
      await this.emit(
        tx,
        'stop.arrived',
        driverId,
        tripId,
        { stopId, stopType: stop.type, distanceM, outsideGeofence: outside, flagged: outside, serverReceivedAt: now.toISOString() },
        { orderId: stop.orderId ?? undefined, location: pin ?? undefined, ...input },
      );
      await this.rederive(trip, driverId, tx);
      return this.view(tripId, tx);
    });
  }

  /**
   * Hand-over at a stop. Only an arrived stop completes ("no stop completed before arrived"); khat
   * stops with a child need the per-child tap (edge-case §5); the event carries the child's opaque
   * vault ref, never the name. Cash collected rides on the
   * event for the orders module (merchant cash account, edge-case §3). Replays are no-ops.
   */
  async completeStop(tripId: string, stopId: string, driverId: string, input: { handover?: HandoverProof | undefined } & DeviceStamp = {}): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.loadForCourier(tripId, driverId, tx);
      const stop = await this.stop(tripId, stopId, tx);
      if (stop.state === 'completed') return this.view(tripId, tx);
      const handover = input.handover ?? {};
      if (
        stop.state === 'skipped' &&
        (await this.lateReplay(tx, trip, stop, 'stop.completed', driverId, input, {
          stopId,
          stopType: stop.type,
          vertical: trip.vertical,
          cashCollectedIqd: handover.cashCollectedIqd ?? null,
          photo: Boolean(handover.photoUrl ?? handover.photoUploadId),
          pinOk: handover.pinOk ?? null,
          serverReceivedAt: this.clock.now().toISOString(),
        }))
      ) {
        return this.view(tripId, tx);
      }
      if (stop.state !== 'arrived') throw new DriverError('stop_state_conflict');
      // Maps program f11: a delivery photo is this courier's own stored upload.
      if (handover.photoUploadId && !(this.photos && (await this.photos.owns(handover.photoUploadId, driverId)))) throw new DriverError('handover_photo_invalid');
      const child = childHandover({ vertical: trip.vertical, childRef: stop.childRef, type: stop.type, childTap: handover.childTap });
      if (!child.ok) throw new DriverError('child_handover_required');
      // "الخردة علينا": cash above the order's total is only the customer's change going to his wallet,
      // checked against the order (cash, recomputed, capped) before anything is written.
      if (handover.changeToWalletIqd !== undefined || (stop.type === 'dropoff' && handover.cashCollectedIqd !== undefined)) {
        const problem = await this.handoverCheck.check(stop.type === 'dropoff' ? stop.orderId : null, handover);
        if (problem) throw new DriverError(problem);
      }
      // Edge-case §5: the guardian's "arrived" push rides on the tap-out, so a child is only tapped out
      // after being tapped in on this run (when the run picks him up at all).
      if (child.tap === 'out') {
        const pickup = (await this.repo.stopsOf(tripId, tx)).find((s) => s.type === 'pickup' && s.childRef === stop.childRef);
        if (pickup && !pickup.childTapInAt) throw new DriverError('khat_child_not_tapped_in');
      }
      const now = this.clock.now();
      await this.repo.updateStop(
        stop.id,
        {
          state: 'completed',
          completedAt: now,
          // Maps program r4: the code the kitchen read off his screen, written by the server.
          handoverProof: { ...stop.handoverProof, ...handover, ...(stop.type === 'pickup' && stop.orderId ? { pickupCode: pickupCodeFor(stop.orderId, driverId) } : {}) },
          ...(child.tap === 'in' ? { childTapInAt: now } : {}),
          ...(child.tap === 'out' ? { childTapOutAt: now } : {}),
        },
        now,
        tx,
      );
      const stamp = { orderId: stop.orderId ?? undefined, ...input };
      await this.emit(
        tx,
        'stop.completed',
        driverId,
        tripId,
        {
          stopId,
          stopType: stop.type,
          vertical: trip.vertical,
          cashCollectedIqd: handover.cashCollectedIqd ?? null,
          ...(handover.changeToWalletIqd !== undefined ? { changeToWalletIqd: handover.changeToWalletIqd } : {}),
          photo: Boolean(handover.photoUrl ?? handover.photoUploadId),
          pinOk: handover.pinOk ?? null,
          serverReceivedAt: now.toISOString(),
          // Maps program a3: a delivered drop-off at a saved place teaches it where its door is.
          // Taps outside the 60 m geofence (the street corner) never teach one.
          ...(stop.type === 'dropoff' && stop.placeId && stop.arrivalPin && stop.arrivalAccuracyM !== null && !stop.arrivedOutsideGeofence
            ? { door: { placeId: stop.placeId, courierId: driverId, lat: stop.arrivalPin.lat, lng: stop.arrivalPin.lng, accuracyM: stop.arrivalAccuracyM } }
            : {}),
        },
        stamp,
      );
      if (child.tap) {
        // Guardian "arrived" push fires only on the tap-out at school (edge-case §5).
        await this.emit(tx, child.tap === 'in' ? 'khat.child_tapped_in' : 'khat.child_tapped_out', driverId, tripId, { stopId, childRef: stop.childRef, notifyGuardian: child.tap === 'out' }, stamp);
      }
      let current = trip;
      if (trip.unreachableStartedAt) {
        current = await this.repo.updateTrip(tripId, { unreachableStartedAt: null, unreachableEscalatedAt: null, unreachableExtendedAt: null }, now, tx);
      }
      await this.rederive(current, driverId, tx);
      return this.view(tripId, tx);
    });
  }

  async skipStop(tripId: string, stopId: string, actorId: string, reason: string, opts: { asCourier?: boolean } & DeviceStamp = {}): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = opts.asCourier === false ? await this.load(tripId, tx) : await this.loadForCourier(tripId, actorId, tx);
      const stop = await this.stop(tripId, stopId, tx);
      if (stop.state === 'skipped') return this.view(tripId, tx);
      if (stop.state === 'completed') throw new DriverError('stop_state_conflict');
      const now = this.clock.now();
      await this.repo.updateStop(stop.id, { state: 'skipped', skippedAt: now, skipReason: reason }, now, tx);
      await this.emit(tx, 'stop.skipped', actorId, tripId, { stopId, stopType: stop.type, reason }, { orderId: stop.orderId ?? undefined, ...opts });
      await this.rederive(trip, actorId, tx);
      return this.view(tripId, tx);
    });
  }

  // ───────────────────────── unreachable protocol ─────────────────────────

  /** "Can't reach" at an arrived dropoff: starts the 5-minute protocol (dispatcher at 3:00, "فشل" at 5:00). */
  async startUnreachable(tripId: string, stopId: string, driverId: string, input: DeviceStamp = {}): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.loadForCourier(tripId, driverId, tx);
      const stop = await this.stop(tripId, stopId, tx);
      if (stop.type !== 'dropoff' || stop.state !== 'arrived') throw new DriverError('stop_state_conflict');
      if (trip.unreachableStartedAt) return this.view(tripId, tx);
      const now = this.clock.now();
      await this.repo.updateTrip(tripId, { unreachableStartedAt: now, unreachableEscalatedAt: null, unreachableExtendedAt: null }, now, tx);
      await this.emit(
        tx,
        'trip.unreachable_started',
        driverId,
        tripId,
        { stopId, contact: ['call', 'whatsapp'], escalateAt: new Date(now.getTime() + UNREACHABLE_ESCALATE_AFTER_MS).toISOString(), failAllowedAt: new Date(now.getTime() + UNREACHABLE_FAIL_AFTER_MS).toISOString() },
        { orderId: stop.orderId ?? undefined, ...input },
      );
      const job = { tripId, stopId, startedAtMs: now.getTime() };
      await this.queue.add(UNREACHABLE_JOBS.escalate, job, { delayMs: UNREACHABLE_ESCALATE_AFTER_MS, jobId: unreachableJobId('escalate', tripId, job.startedAtMs) });
      await this.queue.add(UNREACHABLE_JOBS.allowFail, job, { delayMs: UNREACHABLE_FAIL_AFTER_MS, jobId: unreachableJobId('allowFail', tripId, job.startedAtMs) });
      return this.view(tripId, tx);
    });
  }

  /**
   * «أني نازل» (joy spec J-D8): the customer of the order whose door the courier is waiting at moves
   * the courier's "فشل" by `UNREACHABLE_EXTEND_MS`, once per protocol run (one run = one stop). A
   * second tap is a no-op (`extended: false`). Who may tap is the orders module's check.
   */
  async extendUnreachable(tripId: string, orderId: string, customerId: string): Promise<{ extended: boolean; trip: Trip }> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      const stops = await this.repo.stopsOf(tripId, tx);
      const atDoor = stops.find((s) => s.type === 'dropoff' && s.state === 'arrived');
      if (!trip.unreachableStartedAt || isTerminal(trip.state) || !atDoor || atDoor.orderId !== orderId) throw new DriverError('unreachable_not_active');
      if (trip.unreachableExtendedAt) return { extended: false, trip: await this.view(tripId, tx) };
      const now = this.clock.now();
      await this.repo.updateTrip(tripId, { unreachableExtendedAt: now }, now, tx);
      const failAllowedAt = failAt(trip.unreachableStartedAt, now);
      await this.emit(tx, 'trip.unreachable_extended', customerId, tripId, { stopId: atDoor.id, byCustomer: customerId, extraMs: UNREACHABLE_EXTEND_MS, failAllowedAt: failAllowedAt.toISOString() }, { orderId });
      const startedAtMs = trip.unreachableStartedAt.getTime();
      await this.queue.add(
        UNREACHABLE_JOBS.allowFail,
        { tripId, stopId: atDoor.id, startedAtMs },
        { delayMs: Math.max(0, failAllowedAt.getTime() - now.getTime()), jobId: unreachableJobId('allowFail', tripId, startedAtMs, true) },
      );
      return { extended: true, trip: await this.view(tripId, tx) };
    });
  }

  /**
   * Fails the unreachable dropoff: the driver from minute 5, a dispatcher from minute 3. In a
   * batched trip only that order fails (its stops are skipped and it is detached); otherwise the
   * whole trip fails. The orders module turns this into a dispute with its default outcome.
   */
  async fail(tripId: string, actor: { personId: string; role: FailRole }, reason = 'unreachable'): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = actor.role === 'driver' ? await this.loadForCourier(tripId, actor.personId, tx) : await this.load(tripId, tx);
      if (isTerminal(trip.state)) throw new DriverError('trip_state_conflict');
      if (!trip.unreachableStartedAt) throw new DriverError('unreachable_not_started');
      const now = this.clock.now();
      if (!canFail(trip.unreachableStartedAt, now, actor.role, trip.unreachableExtendedAt)) throw new DriverError('unreachable_too_early');
      const stops = await this.repo.stopsOf(tripId, tx);
      const failed = stops.find((s) => s.type === 'dropoff' && s.state === 'arrived') ?? null;
      const failedOrderId = failed?.orderId ?? null;
      const links = (await this.repo.linksOf(tripId, tx)).filter((l) => l.detachedAt === null);
      const others = stops.filter((s) => !isStopFinished(s.state) && s.orderId !== null && s.orderId !== failedOrderId);
      const evidence = { stopId: failed?.id ?? null, reason, by: actor.role, unreachableStartedAt: trip.unreachableStartedAt.toISOString(), escalatedAt: trip.unreachableEscalatedAt?.toISOString() ?? null };

      if (failedOrderId && others.length > 0) {
        for (const s of stops) if (s.orderId === failedOrderId && !isStopFinished(s.state)) await this.repo.updateStop(s.id, { state: 'skipped', skippedAt: now, skipReason: 'unreachable_failed' }, now, tx);
        const link = links.find((l) => l.orderId === failedOrderId);
        if (link) await this.repo.detach(link.id, { at: now, reason: 'unreachable_failed', changedBy: personOrNull(actor.personId) }, tx);
        const cleared = await this.repo.updateTrip(tripId, { unreachableStartedAt: null, unreachableEscalatedAt: null, unreachableExtendedAt: null }, now, tx);
        await this.emit(tx, 'trip.order_failed', actor.personId, tripId, evidence, { orderId: failedOrderId });
        await this.rederive(cleared, actor.personId, tx);
        return this.view(tripId, tx);
      }

      for (const s of stops) if (!isStopFinished(s.state)) await this.repo.updateStop(s.id, { state: 'skipped', skippedAt: now, skipReason: 'trip_failed' }, now, tx);
      await this.move(trip, 'failed', actor.personId, tx, { cancelledAt: now, cancellationReason: reason }, { ...evidence, orderIds: links.map((l) => l.orderId), failedOrderId });
      return this.view(tripId, tx);
    });
  }

  // ───────────────────────── endings ─────────────────────────

  /**
   * Cancels the trip. Unfinished stops are skipped and every order is detached (so late offline
   * replays are quarantined). Fees are the orders module's business: the event carries what it needs.
   */
  async cancel(tripId: string, by: 'driver' | 'customer' | 'platform', actorId: string, reason: string): Promise<Trip> {
    const to: TripState = by === 'driver' ? 'driver_cancelled' : by === 'customer' ? 'customer_cancelled' : 'platform_cancelled';
    return this.uow.run(async (tx) => {
      const trip = by === 'driver' ? await this.loadForCourier(tripId, actorId, tx) : await this.load(tripId, tx);
      if (trip.state === to) return this.view(tripId, tx);
      await this.finishCancelled(trip, to, actorId, reason, tx);
      return this.view(tripId, tx);
    });
  }

  /**
   * Customer-side ride completion (edge-case review B.24): the rider's "وصلت" completes the trip at
   * the locked quote even if the driver's phone died. Authorisation (is this the rider?) is the
   * orders module's job; unfinished stops are skipped, never marked completed.
   */
  async customerComplete(tripId: string, customerId: string, reason = 'customer_confirmed'): Promise<Trip> {
    return this.uow.run(async (tx) => {
      const trip = await this.load(tripId, tx);
      if (trip.state === 'completed') return this.view(tripId, tx);
      if (!RIDE_VERTICALS.includes(trip.vertical)) throw new DriverError('trip_state_conflict');
      if (!['en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff'].includes(trip.state)) throw new DriverError('trip_state_conflict');
      await this.completeBy(trip, customerId, 'customer', reason, tx);
      return this.view(tripId, tx);
    });
  }

  // ───────────────────────── reads ─────────────────────────

  async get(tripId: string): Promise<Trip> {
    return this.view(tripId);
  }

  /** Trips on the board for a city: on offer or being worked. */
  async active(cityId: string): Promise<Trip[]> {
    const trips = await this.repo.findTrips({ cityId, states: [...OFFER_STATES, ...PROGRESS_STATES] });
    return Promise.all(trips.map((t) => this.view(t.id)));
  }

  /** A driver's unfinished trips. */
  async forDriver(driverId: string): Promise<Trip[]> {
    const trips = await this.repo.findTrips({ courierId: driverId, states: PROGRESS_STATES });
    return Promise.all(trips.map((t) => this.view(t.id)));
  }

  /** The driver's trips completed at or after `since` (khat: a finished run still waiting for its sweep). */
  async completedForDriver(driverId: string, since: Date): Promise<Trip[]> {
    const trips = await this.repo.findTrips({ courierId: driverId, states: ['completed'], completedSince: since });
    return Promise.all(trips.map((t) => this.view(t.id)));
  }

  /** The non-terminal trip an order is currently attached to, if any. */
  async activeForOrder(orderId: string): Promise<Trip | null> {
    for (const link of await this.repo.linksForOrder(orderId)) {
      if (link.detachedAt !== null) continue;
      const trip = await this.repo.findTrip(link.tripId);
      if (trip && !isTerminal(trip.state)) return this.view(trip.id);
    }
    return null;
  }

  /**
   * Who carried (or is carrying) an order: the most recent trip it is still attached to that has a
   * driver. Orders uses it to settle money on `closed` (the courier's delivery fee, the ride's driver).
   */
  async courierOf(orderId: string): Promise<{ tripId: string; courierId: string; vertical: Vertical } | null> {
    return this.uow.run(async (tx) => {
      const links = (await this.repo.linksForOrder(orderId, tx)).filter((l) => l.detachedAt === null).sort((a, b) => b.attachedAt.getTime() - a.attachedAt.getTime());
      for (const l of links) {
        const trip = await this.repo.findTrip(l.tripId, tx);
        if (trip?.courierId) return { tripId: trip.id, courierId: trip.courierId, vertical: trip.vertical };
      }
      return null;
    });
  }

  /** Attach/detach history of an order across trips. */
  async orderHistory(orderId: string): Promise<TripOrderRecord[]> {
    return this.repo.linksForOrder(orderId);
  }

  /** The trip's latest trail point (device time, pin, bearing, speed); null before the first fix. */
  async lastPosition(tripId: string): Promise<{ at: Date; pin: LatLng; bearing: number | null; speedKmh: number | null; driverId: string } | null> {
    const p = await this.repo.lastTrailPoint({ tripId });
    return p ? { at: p.at, pin: p.pin, bearing: p.bearing, speedKmh: p.speedKmh, driverId: p.driverId } : null;
  }

  /** `TripOrderLookup` for the events module (edge-case §10 late replays). */
  async detachedAt(tripId: string, orderId: string): Promise<Date | null> {
    return this.repo.detachedAt(tripId, orderId);
  }

  // ───────────────────────── timers ─────────────────────────

  /** Delayed-job handler. Every job re-checks state, so stale or duplicate jobs are harmless. */
  async handleTimer(name: string, data: TripTimerJob): Promise<void> {
    if (name === TRIP_JOBS.rideAutoComplete && 'positionAtMs' in data) {
      await this.uow.run(async (tx) => {
        const trip = await this.repo.findTrip(data.tripId, tx);
        if (!trip || !['in_transit', 'arrived_dropoff'].includes(trip.state) || !trip.courierId) return;
        const last = await this.repo.lastTrailPoint({ tripId: trip.id }, tx);
        if (!last || last.at.getTime() !== data.positionAtMs) return; // the driver moved or spoke since
        await this.completeBy(trip, SYSTEM, 'system', 'auto_dropoff_geofence_10min', tx);
      });
      return;
    }
    if (!('startedAtMs' in data)) return;
    await this.uow.run(async (tx) => {
      const trip = await this.repo.findTrip(data.tripId, tx);
      if (!trip || isTerminal(trip.state) || trip.unreachableStartedAt?.getTime() !== data.startedAtMs) return;
      const now = this.clock.now();
      if (name === UNREACHABLE_JOBS.escalate && !trip.unreachableEscalatedAt) {
        await this.repo.updateTrip(trip.id, { unreachableEscalatedAt: now }, now, tx);
        await this.emit(tx, 'trip.unreachable_escalated', SYSTEM, trip.id, { stopId: data.stopId, courierId: trip.courierId, dispatcherCard: true });
      } else if (name === UNREACHABLE_JOBS.allowFail && canFail(trip.unreachableStartedAt, now, 'driver', trip.unreachableExtendedAt)) {
        // After «أني نازل» the 5:00 job finds it too early and stays quiet; the 7:00 one announces.
        await this.emit(tx, 'trip.unreachable_fail_allowed', SYSTEM, trip.id, { stopId: data.stopId, courierId: trip.courierId });
      }
    });
  }

  // ───────────────────────── internals ─────────────────────────

  /**
   * Edge-case §10: a tap the device queued offline and replays after its order was detached from
   * this trip (the job was reassigned or cancelled meanwhile) is kept as evidence, not refused: the
   * events module stores it quarantined as `late_replay` (support sees it; no settlement subscriber
   * ever does) and nothing here changes. Anything else hitting a skipped stop stays a conflict.
   */
  private async lateReplay(tx: Tx, trip: TripRecord, stop: StopRecord, type: 'stop.arrived' | 'stop.completed', driverId: string, input: DeviceStamp, payload: Record<string, unknown>): Promise<boolean> {
    if (input.deviceUptimeMs === undefined || !stop.orderId) return false;
    if ((await this.repo.detachedAt(trip.id, stop.orderId)) === null) return false;
    await this.emit(tx, type, driverId, trip.id, payload, { orderId: stop.orderId, ...input });
    return true;
  }

  private async load(tripId: string, tx?: Tx): Promise<TripRecord> {
    const trip = await this.repo.findTrip(tripId, tx);
    if (!trip) throw new DriverError('trip_not_found');
    return trip;
  }

  private async loadForCourier(tripId: string, driverId: string, tx: Tx): Promise<TripRecord> {
    const trip = await this.load(tripId, tx);
    if (trip.courierId !== driverId) throw new DriverError('not_trip_courier');
    return trip;
  }

  private async stop(tripId: string, stopId: string, tx: Tx): Promise<StopRecord> {
    const stop = (await this.repo.stopsOf(tripId, tx)).find((s) => s.id === stopId);
    if (!stop) throw new DriverError('stop_not_found');
    return stop;
  }

  private async assertNotOnActiveTrip(orderId: string, tx: Tx): Promise<void> {
    for (const l of await this.repo.linksForOrder(orderId, tx)) {
      if (l.detachedAt !== null) continue;
      const other = await this.repo.findTrip(l.tripId, tx);
      if (other && !isTerminal(other.state)) throw new DriverError('trip_state_conflict');
    }
  }

  /**
   * Moves the trip to `to` (validated by the machine) with a conditional update on the state it was
   * read in, then emits the domain event. `allowSame` re-emits for a re-offer while already offered.
   */
  private async move(
    trip: TripRecord,
    to: TripState,
    actorId: string,
    tx: Tx,
    patch: Partial<TripRecord> = {},
    payload: Record<string, unknown> = {},
    allowSame = false,
    stamp: DeviceStamp = {},
  ): Promise<TripRecord> {
    if (trip.state === to && !allowSame) return trip;
    try {
      transition(trip.state, to);
    } catch (err) {
      if (err instanceof TripTransitionError) throw new DriverError('trip_state_conflict');
      throw err;
    }
    const now = this.clock.now();
    const next = await this.repo.updateTripIf(trip.id, trip.state, { ...patch, state: to }, now, tx);
    if (!next) throw new DriverError('trip_state_conflict');
    await this.emit(tx, tripEventType(to), actorId, trip.id, { from: trip.state, to, ...payload }, stamp);
    return next;
  }

  /** Re-derives the state from the stops and records the move; completes the trip when every stop is done. */
  private async rederive(trip: TripRecord, actorId: string, tx: Tx): Promise<TripRecord> {
    const fresh = (await this.repo.findTrip(trip.id, tx)) ?? trip;
    const stops = await this.repo.stopsOf(trip.id, tx);
    const derived = deriveTripState(fresh.state, stops);
    if (derived === fresh.state) return fresh;
    if (derived === 'completed') {
      await this.completeBy(fresh, actorId, 'driver', 'all_stops_done', tx);
      return (await this.repo.findTrip(trip.id, tx))!;
    }
    return this.move(fresh, derived, actorId, tx, {}, { derived: true });
  }

  private async completeBy(trip: TripRecord, actorId: string, by: 'driver' | 'customer' | 'system', reason: string, tx: Tx): Promise<void> {
    const now = this.clock.now();
    for (const s of await this.repo.stopsOf(trip.id, tx)) {
      if (!isStopFinished(s.state)) await this.repo.updateStop(s.id, { state: 'skipped', skippedAt: now, skipReason: reason }, now, tx);
    }
    const links = (await this.repo.linksOf(trip.id, tx)).filter((l) => l.detachedAt === null);
    await this.move(trip, 'completed', actorId, tx, { completedAt: now, unreachableStartedAt: null, unreachableEscalatedAt: null, unreachableExtendedAt: null }, { by, reason, orderIds: links.map((l) => l.orderId) });
  }

  private async finishCancelled(trip: TripRecord, to: TripState, actorId: string, reason: string, tx: Tx): Promise<void> {
    if (!canMove(trip.state, to)) throw new DriverError('trip_state_conflict');
    const now = this.clock.now();
    const stops = await this.repo.stopsOf(trip.id, tx);
    for (const s of stops) if (!isStopFinished(s.state)) await this.repo.updateStop(s.id, { state: 'skipped', skippedAt: now, skipReason: `cancelled:${reason}` }, now, tx);
    const links = (await this.repo.linksOf(trip.id, tx)).filter((l) => l.detachedAt === null);
    for (const l of links) await this.repo.detach(l.id, { at: now, reason: `trip_${to}`, changedBy: personOrNull(actorId) }, tx);
    const arrivedPickup = stops.filter((s) => s.type === 'pickup' && s.arrivedAt).map((s) => s.arrivedAt!.getTime());
    const pickedUpOrderIds = [...new Set(stops.filter((s) => (s.type === 'pickup' || s.type === 'shop') && s.state === 'completed' && s.orderId).map((s) => s.orderId!))];
    await this.move(trip, to, actorId, tx, { cancelledAt: now, cancellationReason: reason, unreachableStartedAt: null, unreachableEscalatedAt: null, unreachableExtendedAt: null }, {
      by: to === 'driver_cancelled' ? 'driver' : to === 'customer_cancelled' ? 'customer' : 'platform',
      reason,
      courierId: trip.courierId,
      acceptedAt: trip.acceptedAt?.toISOString() ?? null,
      arrivedPickupAt: arrivedPickup.length ? new Date(Math.min(...arrivedPickup)).toISOString() : null,
      orderIds: links.map((l) => l.orderId),
      pickedUpOrderIds,
    });
  }

  private async emit(
    tx: Tx | undefined,
    type: string,
    actorId: string,
    tripId: string,
    payload: Record<string, unknown>,
    opts: { orderId?: string | undefined; location?: LatLng | undefined } & DeviceStamp = {},
  ): Promise<void> {
    await this.events.emit(
      tx,
      {
        type,
        actorId,
        occurredAt: opts.occurredAt ?? this.clock.now(),
        tripId,
        // Cross-module events are validated against their shared contract before they reach the outbox.
        payload: isDomainEventType(type) ? encodeDomainEvent(type, payload as never) : payload,
        ...(opts.orderId ? { orderId: opts.orderId } : {}),
        ...(opts.location ? { location: opts.location } : {}),
        ...(opts.idempotencyKey ? { idempotencyKey: scopedIdempotencyKey(type, actorId, tripId, payload, opts.idempotencyKey) } : {}),
        ...(opts.deviceUptimeMs !== undefined ? { deviceUptimeMs: opts.deviceUptimeMs } : {}),
      },
      { name: 'trip', id: tripId },
    );
  }

  private async view(tripId: string, tx?: Tx): Promise<Trip> {
    const trip = await this.load(tripId, tx);
    const [stops, links] = await Promise.all([this.repo.stopsOf(tripId, tx), this.repo.linksOf(tripId, tx)]);
    return toTripView(trip, stops, links);
  }
}

/**
 * A client idempotency key only dedupes a replay of the SAME action (review H): it is scoped by event
 * type, actor and aggregate (trip, and the stop for stop events). Reusing a key on another trip or
 * stop (an app bug, or a key generator restarting) can therefore never swallow a different action's
 * events — before, a reused key completed the trip while its `stop.completed` never reached orders
 * or the ledger.
 */
/** A committed position report, as `onPositionReported` observers get it. */
export interface PositionReport {
  driverId: string;
  pin: LatLng;
  at: Date;
  bearing: number | null;
  speedKmh: number | null;
  /** The trips the fix was recorded on (his trips in progress; none when idle). */
  tripIds: string[];
}

export function scopedIdempotencyKey(type: string, actorId: string, tripId: string, payload: Record<string, unknown>, clientKey: string): string {
  const stop = typeof payload['stopId'] === 'string' ? `/stop:${payload['stopId']}` : '';
  return `${type}:${actorId}:trip:${tripId}${stop}:${clientKey}`;
}

function canMove(from: TripState, to: TripState): boolean {
  try {
    transition(from, to);
    return true;
  } catch {
    return false;
  }
}

/** System actors are not people: `trip_orders.changed_by` references `people`. */
function personOrNull(actorId: string): string | null {
  return actorId === SYSTEM ? null : actorId;
}

export function toTripView(trip: TripRecord, stops: StopRecord[], links: TripOrderRecord[]): Trip {
  const unreachableStop = stops.find((s) => s.type === 'dropoff' && s.state === 'arrived');
  return {
    id: trip.id,
    cityId: trip.cityId,
    vertical: trip.vertical,
    state: trip.state,
    courierId: trip.courierId,
    vehicleId: trip.vehicleId,
    quoteId: trip.quoteId,
    batchId: trip.batchId,
    offeredAt: trip.offeredAt,
    acceptedAt: trip.acceptedAt,
    completedAt: trip.completedAt,
    cancelledAt: trip.cancelledAt,
    cancellationReason: trip.cancellationReason,
    unreachable: unreachableStatus({ stopId: unreachableStop?.id ?? null, startedAt: trip.unreachableStartedAt, escalatedAt: trip.unreachableEscalatedAt, extendedAt: trip.unreachableExtendedAt }),
    stops: stops.map(toStopView),
    orders: links.map((l) => ({ orderId: l.orderId, attachedAt: l.attachedAt, detachedAt: l.detachedAt, reason: l.reason, minVehicleClass: l.minVehicleClass })),
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}

function toStopView(s: StopRecord): Stop {
  return {
    id: s.id,
    tripId: s.tripId,
    seq: s.seq,
    orderId: s.orderId,
    type: s.type,
    state: s.state,
    placeId: s.placeId,
    meetingPointId: s.meetingPointId,
    zoneKey: s.zoneKey,
    target: s.target,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    geofenceEnteredAt: s.geofenceEnteredAt,
    courierNearAt: s.courierNearAt,
    arrivedAt: s.arrivedAt,
    arrivedOutsideGeofence: s.arrivedOutsideGeofence,
    arrivalDistanceM: s.arrivalDistanceM,
    completedAt: s.completedAt,
    skippedAt: s.skippedAt,
    skipReason: s.skipReason,
    handoverProof: s.handoverProof,
    childRef: s.childRef,
    childTapInAt: s.childTapInAt,
    childTapOutAt: s.childTapOutAt,
  };
}

/** The order's food has left the kitchen: its pickup (or shop) stop on this trip is completed. */
function pickedUpFor(stops: readonly StopRecord[], orderId: string | null): boolean {
  return orderId !== null && stops.some((p) => p.orderId === orderId && (p.type === 'pickup' || p.type === 'shop') && p.state === 'completed');
}
