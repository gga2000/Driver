import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type AbsenceView,
  type Actor,
  type CallGuardianInput,
  type CallSession,
  type ConfirmEmptyCarInput,
  type KhatPort,
  type KhatRunTrip,
  type KhatTapInput,
  type ReportAbsenceInput,
  type SubstituteOffer,
  type TodayRunView,
  type Trip,
} from '@driver/contracts';
import type { CallBridgePort } from '../../shared/call-bridge.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { localDateKey } from '../../shared/local-time.js';
import { DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { TripsService } from '../trips/index.js';
import { KHAT_REPOSITORY, type AbsenceRecord, type KhatRepository } from './khat.repository.js';

const DONE_TRIP_STATES = new Set(['driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed']);

/** The masked-call bridge for guardian calls (shared with chat and الرجعة; optional in harnesses). */
export const KHAT_CALLS = Symbol('KHAT_CALLS');

/** When a khat run happens: its first stop window, else when it was accepted / created. */
function runAt(t: Trip): Date {
  const windows = t.stops.map((s) => s.windowStart).filter((d): d is Date => d !== null);
  return windows.length > 0 ? new Date(Math.min(...windows.map((d) => d.getTime()))) : (t.acceptedAt ?? t.createdAt);
}

/** The sweep's event: one per run (idempotency key), the ops record of "no child left in the car". */
export const EMPTY_CAR_EVENT = 'khat.empty_car_confirmed';

/** Every child stop on the run is done: dropped, skipped, or the child reported absent. */
export function runSettled(trip: Trip, absences: readonly AbsenceRecord[]): boolean {
  const absent = new Set(absences.filter((a) => a.tripId === trip.id).map((a) => a.childRef));
  const childStops = trip.stops.filter((s) => s.childRef);
  return childStops.length > 0 && childStops.every((s) => s.state === 'completed' || s.state === 'skipped' || absent.has(s.childRef!));
}

export function runTripView(trip: Trip, names: Record<string, string>, absences: readonly AbsenceRecord[], emptyCarCheckedAt: Date | null = null): KhatRunTrip {
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
    emptyCarCheckedAt,
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
    @Optional() @Inject(KHAT_CALLS) private readonly calls: CallBridgePort | null = null,
  ) {}

  async todayRun(actor: Actor, input: { date?: Date | undefined }): Promise<TodayRunView> {
    const localDate = localDateKey(input.date ?? this.clock.now());
    const trips = (await this.trips.forDriver(actor.personId)).filter((t) => t.vertical === 'khat' && !DONE_TRIP_STATES.has(t.state) && localDateKey(runAt(t)) === localDate);
    trips.sort((a, b) => runAt(a).getTime() - runAt(b).getTime());
    const refs = trips.flatMap((t) => t.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r)));
    const names = refs.length > 0 ? await this.identity.childFirstNamesForRun(actor.personId, refs) : {};
    const absences = await this.repo.absencesForTrips(trips.map((t) => t.id));
    const swept = await Promise.all(trips.map((t) => this.emptyCarCheckedAt(t.id)));
    return { localDate, trips: trips.map((t, i) => runTripView(t, names, absences, swept[i] ?? null)) };
  }

  /** When the run's sweep was confirmed (its one event in the append-only log), or null. */
  private async emptyCarCheckedAt(tripId: string): Promise<Date | null> {
    const e = (await this.events.forTrip(tripId)).find((x) => x.type === EMPTY_CAR_EVENT);
    return e ? e.occurredAt : null;
  }

  /**
   * "تأكدت، السيارة فاضية" (partner S-6): after the last child is dropped (or reported absent), the
   * driver looks at the back seats and confirms the car is empty. Logged once per run as
   * `khat.empty_car_confirmed` (trip-scoped, so ops see it on the run's timeline) with the counts
   * and how long after the last drop it came. Refused while a child stop is still open.
   */
  async confirmEmptyCar(actor: Actor, input: ConfirmEmptyCarInput): Promise<KhatRunTrip> {
    const trip = await this.ownRun(actor, input.tripId);
    const absences = await this.repo.absencesForTrips([trip.id]);
    if (!runSettled(trip, absences)) throw new DriverError('khat_run_not_finished');
    if (!(await this.emptyCarCheckedAt(trip.id))) {
      const now = this.clock.now();
      const view = runTripView(trip, {}, absences);
      const drops = trip.stops.map((s) => s.childTapOutAt).filter((d): d is Date => d !== null);
      const lastDropAt = drops.length > 0 ? new Date(Math.max(...drops.map((d) => d.getTime()))) : null;
      await this.events.emit(
        undefined,
        {
          actorId: actor.personId,
          type: EMPTY_CAR_EVENT,
          occurredAt: now,
          tripId: trip.id,
          idempotencyKey: `khat:empty_car:${trip.id}`,
          payload: {
            tripId: trip.id,
            driverId: actor.personId,
            childrenTotal: view.childrenTotal,
            delivered: view.delivered,
            absent: view.absent,
            lastDropAt: lastDropAt?.toISOString() ?? null,
            secondsAfterLastDrop: lastDropAt ? Math.max(0, Math.round((now.getTime() - lastDropAt.getTime()) / 1000)) : null,
          },
        },
        { name: 'trip', id: trip.id },
      );
    }
    return this.view(actor, trip);
  }

  /**
   * The call icon on a child's row: a masked call to that child's guardian (the run's own driver,
   * the child on this run, the run not cancelled). Logged as `khat.guardian_call_requested`.
   */
  async callGuardian(actor: Actor, input: CallGuardianInput): Promise<CallSession> {
    const trip = await this.ownRun(actor, input.tripId);
    if (DONE_TRIP_STATES.has(trip.state)) throw new DriverError('call_unavailable');
    if (!trip.stops.some((s) => s.childRef === input.childRef)) throw new DriverError('khat_child_not_on_trip');
    const guardianId = await this.identity.guardianForCall(actor.personId, input.childRef);
    if (!guardianId || !this.calls) throw new DriverError('call_unavailable');
    const now = this.clock.now();
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const session = await this.calls.open({ callId, orderId: trip.id, callerId: actor.personId, calleeId: guardianId }, now);
    await this.events.emit(
      undefined,
      { actorId: actor.personId, type: 'khat.guardian_call_requested', occurredAt: now, tripId: trip.id, payload: { tripId: trip.id, childRef: input.childRef, callId, mode: session.mode } },
      { name: 'trip', id: trip.id },
    );
    return { callId, mode: session.mode, dial: session.dial, counterpart: 'customer', expiresAt: session.expiresAt };
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
    return runTripView(trip, names, await this.repo.absencesForTrips([trip.id]), await this.emptyCarCheckedAt(trip.id));
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
