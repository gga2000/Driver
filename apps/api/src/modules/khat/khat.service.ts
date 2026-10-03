import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  type AbsenceView,
  type Actor,
  type KhatPort,
  type KhatRunTrip,
  type KhatTapInput,
  type ReportAbsenceInput,
  type SubstituteOffer,
  type TodayRunView,
  type Trip,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { localDateKey } from '../../shared/local-time.js';
import { DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { TripsService } from '../trips/index.js';
import { KHAT_REPOSITORY, type AbsenceRecord, type KhatRepository } from './khat.repository.js';

const DONE_TRIP_STATES = new Set(['driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed']);

/** When a khat run happens: its first stop window, else when it was accepted / created. */
function runAt(t: Trip): Date {
  const windows = t.stops.map((s) => s.windowStart).filter((d): d is Date => d !== null);
  return windows.length > 0 ? new Date(Math.min(...windows.map((d) => d.getTime()))) : (t.acceptedAt ?? t.createdAt);
}

export function runTripView(trip: Trip, names: Record<string, string>, absences: readonly AbsenceRecord[]): KhatRunTrip {
  const absent = new Set(absences.filter((a) => a.tripId === trip.id).map((a) => a.childRef));
  const children = new Set(trip.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r)));
  let onBoard = 0;
  let delivered = 0;
  for (const ref of children) {
    const pickup = trip.stops.find((s) => s.childRef === ref && s.type === 'pickup');
    const dropoff = trip.stops.find((s) => s.childRef === ref && s.type === 'dropoff');
    if (dropoff?.childTapOutAt) delivered += 1;
    else if (pickup?.childTapInAt) onBoard += 1;
  }
  return {
    tripId: trip.id,
    state: trip.state,
    stops: [...trip.stops]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        stopId: s.id,
        seq: s.seq,
        type: s.type,
        state: s.state,
        zoneKey: s.zoneKey,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        child: s.childRef ? { childRef: s.childRef, firstName: names[s.childRef] ?? '—' } : null,
        tappedInAt: s.childTapInAt,
        tappedOutAt: s.childTapOutAt,
        absent: s.childRef ? absent.has(s.childRef) : false,
      })),
    childrenTotal: children.size,
    onBoard,
    delivered,
    absent: [...absent].filter((r) => children.has(r)).length,
  };
}

/**
 * خطوط driver side (edge-case §5). Runs are khat Trips; taps go through `TripsService.completeStop`
 * with the per-child tap (which emits `khat.child_tapped_in/out`, the guardian push on tap-out).
 * Children's first names come from identity for the run's own driver only, each read logged.
 * Substitute offers are dispatch's (pre_assigned substitute auction); accepting is `dispatch.respond`.
 */
@Injectable()
export class KhatService implements KhatPort {
  constructor(
    @Inject(KHAT_REPOSITORY) private readonly repo: KhatRepository,
    private readonly trips: TripsService,
    private readonly identity: IdentityService,
    private readonly dispatch: DispatchService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async todayRun(actor: Actor, input: { date?: Date | undefined }): Promise<TodayRunView> {
    const localDate = localDateKey(input.date ?? this.clock.now());
    const trips = (await this.trips.forDriver(actor.personId)).filter((t) => t.vertical === 'khat' && !DONE_TRIP_STATES.has(t.state) && localDateKey(runAt(t)) === localDate);
    trips.sort((a, b) => runAt(a).getTime() - runAt(b).getTime());
    const refs = trips.flatMap((t) => t.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r)));
    const names = refs.length > 0 ? await this.identity.childFirstNamesForRun(actor.personId, refs) : {};
    const absences = await this.repo.absencesForTrips(trips.map((t) => t.id));
    return { localDate, trips: trips.map((t) => runTripView(t, names, absences)) };
  }

  tapIn(actor: Actor, input: KhatTapInput): Promise<KhatRunTrip> {
    return this.tap(actor, input, 'in');
  }

  tapOut(actor: Actor, input: KhatTapInput): Promise<KhatRunTrip> {
    return this.tap(actor, input, 'out');
  }

  private async ownRun(actor: Actor, tripId: string): Promise<Trip> {
    const trip = await this.trips.get(tripId);
    if (trip.courierId !== actor.personId || trip.vertical !== 'khat') throw new DriverError('forbidden');
    return trip;
  }

  /** Arrives the stop if needed (geofence evidence as usual), then completes it with the child's tap. */
  private async tap(actor: Actor, input: KhatTapInput, tap: 'in' | 'out'): Promise<KhatRunTrip> {
    const trip = await this.ownRun(actor, input.tripId);
    const stop = trip.stops.find((s) => s.id === input.stopId);
    if (!stop) throw new DriverError('not_found');
    if (!stop.childRef || stop.type !== (tap === 'in' ? 'pickup' : 'dropoff')) throw new DriverError('khat_not_child_stop');
    if (await this.repo.absence(trip.id, stop.childRef)) throw new DriverError('khat_child_absent');
    const stamp = {
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      ...(input.deviceUptimeMs !== undefined ? { deviceUptimeMs: input.deviceUptimeMs } : {}),
    };
    if (stop.state === 'pending') {
      await this.trips.arrive(trip.id, stop.id, actor.personId, { ...stamp, ...(input.pin ? { pin: input.pin } : {}), ...(input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}:arrive` } : {}) });
    }
    const after = await this.trips.completeStop(trip.id, stop.id, actor.personId, { handover: { childTap: tap }, ...stamp, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
    return this.view(actor, after);
  }

  private async view(actor: Actor, trip: Trip): Promise<KhatRunTrip> {
    const refs = trip.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r));
    const names = refs.length > 0 ? await this.identity.childFirstNamesForRun(actor.personId, refs) : {};
    return runTripView(trip, names, await this.repo.absencesForTrips([trip.id]));
  }

  /**
   * The driver reports a child absent for this run (guardian told him, or nobody at the stop): the
   * child's unfinished stops are skipped and `khat.absence_reported` goes out (guardian + ops). A
   * child already tapped in cannot be reported absent. Repeating the report returns the first one.
   */
  async reportAbsence(actor: Actor, input: ReportAbsenceInput): Promise<AbsenceView> {
    const trip = await this.ownRun(actor, input.tripId);
    const stops = trip.stops.filter((s) => s.childRef === input.childRef);
    if (stops.length === 0) throw new DriverError('khat_child_not_on_trip');
    const existing = await this.repo.absence(trip.id, input.childRef);
    if (existing) return absenceView(existing);
    if (stops.some((s) => s.childTapInAt !== null)) throw new DriverError('stop_state_conflict');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const skipped: string[] = [];
      for (const s of stops) {
        if (s.state === 'completed' || s.state === 'skipped') continue;
        await this.trips.skipStop(trip.id, s.id, actor.personId, `absent:${input.reason}`);
        skipped.push(s.id);
      }
      const row = await this.repo.createAbsence(
        { tripId: trip.id, childRef: input.childRef, localDate: localDateKey(now), reportedById: actor.personId, reason: input.reason, note: input.note ?? null, skippedStopIds: skipped, createdAt: now },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'khat.absence_reported', occurredAt: now, tripId: trip.id, payload: { tripId: trip.id, childRef: input.childRef, reason: input.reason, skippedStopIds: skipped, notifyGuardian: true } },
        { name: 'trip', id: trip.id },
      );
      return absenceView(row);
    });
  }

  /** Open substitute-auction offers to this driver on khat trips (dispatch's pre_assigned pass 2). */
  async substituteOffers(actor: Actor, input: { cityId: string }): Promise<SubstituteOffer[]> {
    const board = await this.dispatch.board(input.cityId);
    const out: SubstituteOffer[] = [];
    for (const card of board.cards) {
      if (card.vertical !== 'khat') continue;
      for (const o of card.offers) {
        if (o.driverId !== actor.personId || (o.state !== 'sent' && o.state !== 'seen')) continue;
        const trip = await this.trips.get(card.tripId);
        const windows = trip.stops.map((s) => s.windowStart).filter((d): d is Date => d !== null);
        out.push({
          offerId: o.offerId,
          tripId: card.tripId,
          expiresInSec: o.expiresInSec,
          stopsCount: trip.stops.length,
          childrenCount: new Set(trip.stops.map((s) => s.childRef).filter(Boolean)).size,
          firstWindowStart: windows.length > 0 ? new Date(Math.min(...windows.map((d) => d.getTime()))) : null,
          zones: [...new Set(trip.stops.map((s) => s.zoneKey))],
          compensationIqd: o.compensationIqd,
        });
      }
    }
    return out.sort((a, b) => a.expiresInSec - b.expiresInSec);
  }

  async acceptSubstitute(actor: Actor, input: { offerId: string }): Promise<{ outcome: 'assigned' | 'declined'; tripId: string }> {
    const res = await this.dispatch.respond(actor, { offerId: input.offerId, accept: true });
    return { outcome: res.outcome, tripId: res.tripId };
  }
}

function absenceView(r: AbsenceRecord): AbsenceView {
  return { absenceId: r.id, tripId: r.tripId, childRef: r.childRef, reason: r.reason, skippedStopIds: [...r.skippedStopIds], reportedAt: r.createdAt };
}
