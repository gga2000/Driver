import { z } from 'zod';
import { ETA_LEARNING_RULES, ETA_LEARNING_VERTICALS, TripAcceptedPayload, type LatLng, type Trip, type VehicleClass } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService, PublishedEvent, StoredEvent } from '../events/index.js';
import type { BaseEtaMinutes } from '../routing/index.js';
import type { EtaCorrectionsRepository } from './eta-corrections.repository.js';
import { hourBucketOf, judgeLeg, lookupChain, type EtaLearningRules } from './eta-learning.js';
import type { ZoneLocator } from './learned-eta-correction.js';

/** Subscriber name, and so its dedupe key in `subscriber_deliveries`. */
export const ETA_LEARNING_SUBSCRIBER = 'eta:learn-legs';

/** What the learner reads from trips: the trip with its stops, and its GPS trail for the first leg. */
export interface EtaLearnerTrips {
  get(tripId: string): Promise<Trip>;
  trailOf(tripId: string): Promise<ReadonlyArray<{ driverId: string; at: Date; pin: LatLng }>>;
}

/** The router's uncorrected estimate (`EtaService.baseMinutes`): a leg is judged against it, never against a corrected one. */
export interface EtaLearnerRoutes {
  baseMinutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<BaseEtaMinutes>;
}

export type EtaLearnOutcome =
  | 'learned'
  | 'duplicate'
  | 'quarantined'
  | 'not_learnable_vertical'
  | 'no_arrival'
  | 'outside_geofence'
  | 'late_tap'
  | 'no_leg_start'
  | 'not_direct'
  | 'no_vehicle'
  | 'outside_zones'
  | 'too_short'
  | 'outlier';

const StopArrived = z.object({ stopId: z.string().min(1) });
const StopTap = z.object({ stopId: z.string().min(1) });

interface LegStart {
  pin: LatLng;
  at: Date;
  /** The stop the leg starts from (its completion); null for the first leg, which starts at acceptance. */
  fromStopId: string | null;
}

/**
 * Teaches the one ETA from finished legs (maps program f7). On every `stop.arrived` it rebuilds the
 * leg that ended there and, when the leg is clean, folds actual ÷ predicted into its cells:
 *
 * - **Between stops** (picked up → arrived at the door, or one stop to the next): from the previous
 *   stop's completion (server time) at that stop's own pin — the kitchen or door the ETA routes from —
 *   to this arrival (server time). Handover and kitchen waits fall outside the leg by construction.
 * - **First leg** (accepted → first stop): from the acceptance, at his first trail point on the trip
 *   when it came within `firstFixMaxDelayMs` of the acceptance; no such fix, no leg.
 *
 * Skipped: quarantined late replays, الرجعة / خطوط, taps outside the 60 m geofence, taps the phone
 * queued offline (device time far from receipt), legs that passed through another stop, legs with an
 * end outside the zones, too-short legs and outliers. Idempotent by stop: the subscriber dedupe plus
 * the unique `eta_samples.stop_id`.
 */
export class EtaLearner {
  constructor(
    private readonly trips: EtaLearnerTrips,
    private readonly events: Pick<EventsService, 'forTrip'>,
    private readonly routes: EtaLearnerRoutes,
    private readonly repo: EtaCorrectionsRepository,
    private readonly zones: ZoneLocator,
    private readonly learnt: { forget(cityId: string): void },
    private readonly rules: EtaLearningRules = ETA_LEARNING_RULES,
  ) {}

  register(events: Pick<EventsService, 'subscribe'>): () => void {
    return events.subscribe(ETA_LEARNING_SUBSCRIBER, ['stop.arrived'], async (e, ctx) => {
      await this.onStopArrived(e, ctx.tx);
    });
  }

  async onStopArrived(e: Pick<PublishedEvent, 'quarantined' | 'tripId' | 'payload' | 'occurredAt'>, tx?: Tx): Promise<EtaLearnOutcome | 'not_a_stop'> {
    if (e.quarantined) return 'quarantined';
    const parsed = StopArrived.safeParse(e.payload);
    if (!e.tripId || !parsed.success) return 'not_a_stop';
    const trip = await this.trips.get(e.tripId);
    if (!ETA_LEARNING_VERTICALS.includes(trip.vertical) || !trip.courierId || !trip.acceptedAt) return 'not_learnable_vertical';
    const stop = trip.stops.find((s) => s.id === parsed.data.stopId);
    if (!stop?.target || !stop.arrivedAt) return 'no_arrival';
    if (stop.arrivedOutsideGeofence) return 'outside_geofence';
    if (this.late(e.occurredAt, stop.arrivedAt)) return 'late_tap';

    const start = await this.legStart(trip, stop.id, stop.arrivedAt);
    if (!start) return 'no_leg_start';
    // He went somewhere else on the way (arrived at another stop, then skipped it): not one leg.
    if (trip.stops.some((s) => s.id !== stop.id && s.id !== start.fromStopId && s.arrivedAt && s.arrivedAt > start.at && s.arrivedAt < stop.arrivedAt!)) return 'not_direct';

    const events = await this.events.forTrip(trip.id);
    if (start.fromStopId && this.lateCompletion(events, start.fromStopId, start.at)) return 'late_tap';
    const vehicle = vehicleOf(events, trip.courierId);
    if (!vehicle) return 'no_vehicle';

    const fromZone = this.zones.zoneIn(trip.cityId, start.pin);
    const toZone = this.zones.zoneIn(trip.cityId, stop.target);
    if (!fromZone || !toZone) return 'outside_zones';

    const predicted = await this.routes.baseMinutes(start.pin, stop.target, vehicle);
    const actualMin = (stop.arrivedAt.getTime() - start.at.getTime()) / 60_000;
    const verdict = judgeLeg(actualMin, predicted.exactMinutes, this.rules);
    if (!verdict.ok) return verdict.reason;

    const leg = { cityId: trip.cityId, fromZone, toZone, hourBucket: hourBucketOf(start.at, this.rules), vehicleClass: vehicle, basis: predicted.basis };
    const fresh = await this.repo.learn(
      { ...leg, stopId: stop.id, tripId: trip.id, predictedMin: predicted.exactMinutes, actualMin, startedAt: start.at, arrivedAt: stop.arrivedAt },
      lookupChain(leg),
      this.rules.alpha,
      tx,
    );
    if (!fresh) return 'duplicate';
    this.learnt.forget(trip.cityId);
    return 'learned';
  }

  /** Where and when the leg into this stop began (see the class comment); null when unknown. */
  private async legStart(trip: Trip, stopId: string, arrivedAt: Date): Promise<LegStart | null> {
    let prev: { id: string; target: LatLng; completedAt: Date } | null = null;
    for (const s of trip.stops) {
      if (s.id === stopId || !s.target || !s.completedAt || s.completedAt > arrivedAt) continue;
      if (!prev || s.completedAt > prev.completedAt) prev = { id: s.id, target: s.target, completedAt: s.completedAt };
    }
    if (prev) return { pin: prev.target, at: prev.completedAt, fromStopId: prev.id };
    const acceptedAt = trip.acceptedAt;
    if (!acceptedAt) return null;
    const first = (await this.trips.trailOf(trip.id)).find((p) => p.driverId === trip.courierId);
    if (!first || Math.abs(first.at.getTime() - acceptedAt.getTime()) > this.rules.firstFixMaxDelayMs) return null;
    return { pin: first.pin, at: acceptedAt, fromStopId: null };
  }

  private late(deviceAt: Date, serverAt: Date): boolean {
    return Math.abs(deviceAt.getTime() - serverAt.getTime()) > this.rules.maxTapDelayMs;
  }

  /** The completion that starts the leg was a tap the phone queued offline. */
  private lateCompletion(events: readonly StoredEvent[], stopId: string, completedAt: Date): boolean {
    const tap = events.find((ev) => ev.type === 'stop.completed' && !ev.quarantined && StopTap.safeParse(ev.payload).data?.stopId === stopId);
    return tap !== undefined && this.late(tap.occurredAt, completedAt);
  }
}

/** The vehicle he accepted the trip with (`trip.accepted`, latest for this courier). */
function vehicleOf(events: readonly StoredEvent[], courierId: string): VehicleClass | null {
  let found: { at: number; vehicle: VehicleClass } | null = null;
  for (const ev of events) {
    if (ev.type !== 'trip.accepted') continue;
    const p = TripAcceptedPayload.safeParse(ev.payload);
    if (!p.success || p.data.driverId !== courierId) continue;
    if (!found || ev.occurredAt.getTime() >= found.at) found = { at: ev.occurredAt.getTime(), vehicle: p.data.vehicleClass };
  }
  return found?.vehicle ?? null;
}
