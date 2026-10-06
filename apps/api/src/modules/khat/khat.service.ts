import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  KHAT_RULES,
  type AbsenceView,
  type Actor,
  type CallGuardianInput,
  type CallSession,
  type ConfirmEmptyCarInput,
  type GuardianChild,
  type KhatPort,
  type KhatRunTrip,
  type KhatSweepAlert,
  type KhatSweepAlertsInput,
  type KhatSweepCallInput,
  type KhatTapInput,
  type RemoveChildPhotoInput,
  type ReportAbsenceInput,
  type SafetyCallSession,
  type SetChildPhotoInput,
  type SubstituteOffer,
  type TodayRunView,
  type Trip,
} from '@driver/contracts';
import type { CallBridgePort } from '../../shared/call-bridge.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { localDateKey } from '../../shared/local-time.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import { DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService, shortDisplayName } from '../identity/index.js';
import { TripsService } from '../trips/index.js';
import { KHAT_REPOSITORY, type AbsenceRecord, type KhatRepository, type SweepAlertRecord } from './khat.repository.js';

const DAY_MS = 24 * 60 * 60_000;
const DONE_TRIP_STATES = new Set(['driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed']);

/** The masked-call bridge for guardian calls (shared with chat and الرجعة; optional in harnesses). */
export const KHAT_CALLS = Symbol('KHAT_CALLS');

/** The `khat.timers` queue: the sweep check after a run ends (BullMQ with Redis, in process otherwise). */
export const KHAT_QUEUE = Symbol('KHAT_QUEUE');
export const KHAT_CONFIG = Symbol('KHAT_CONFIG');
/** Child photos' storage (the places module's blob store): ownership check, signed reads, deletion. */
export const KHAT_PHOTOS = Symbol('KHAT_PHOTOS');

export interface KhatPhotosPort {
  /** A stored upload of `personId` (pending or someone else's is not his photo). */
  owns(uploadId: string, personId: string): Promise<boolean>;
  readUrl(ref: string): string;
  remove(ref: string): Promise<void>;
}

export interface KhatConfig {
  /** Minutes after the run's last child stop before a missing sweep alerts ops (`KHAT_RULES`). */
  sweepAlertAfterMin: number;
}

export const DEFAULT_KHAT_CONFIG: KhatConfig = { sweepAlertAfterMin: KHAT_RULES.sweepAlertAfterMin };

export interface SweepCheckJob {
  tripId: string;
}

/** The job's name on `khat.timers`. */
export const SWEEP_CHECK_JOB = 'khat.sweepCheck';
/** Outbox subscriber that arms the sweep timer for runs settled outside `khat.tapOut` / `reportAbsence`. */
export const SWEEP_TIMER_SUBSCRIBER = 'khat:sweep-timer';
/** Raised once per run when the sweep is late: the notify subscriber pushes the driver's reminder. */
export const SWEEP_MISSED_EVENT = 'khat.sweep_missed';
/** The driver's late confirm cleared the run's alert. */
export const SWEEP_CLEARED_EVENT = 'khat.sweep_alert_cleared';

export type SweepCheckOutcome = 'raised' | 'swept' | 'already' | 'not_due' | 'not_applicable';

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

/** When the run's last child stop settled (tapped out, completed or skipped); null while one is open. */
export function runEndedAt(trip: Trip, absences: readonly AbsenceRecord[]): Date | null {
  if (!runSettled(trip, absences)) return null;
  const at = trip.stops.filter((s) => s.childRef).map((s) => (s.childTapOutAt ?? s.completedAt ?? s.skippedAt)?.getTime() ?? 0);
  const ms = Math.max(...at);
  return ms > 0 ? new Date(ms) : null;
}

/** The latest school tap-out on the run and that stop's zone. */
function lastDrop(trip: Trip): { at: Date | null; zoneKey: string | null } {
  let best: { at: Date | null; zoneKey: string | null } = { at: null, zoneKey: null };
  for (const s of trip.stops) {
    if (s.childTapOutAt && (!best.at || s.childTapOutAt.getTime() > best.at.getTime())) best = { at: s.childTapOutAt, zoneKey: s.zoneKey };
  }
  return best;
}

/** A child on the run as its driver sees it: first name and the guardian's photo (signed URL) or null. */
export interface RunChild {
  firstName: string;
  photoUrl: string | null;
}

export function runTripView(trip: Trip, names: Record<string, RunChild>, absences: readonly AbsenceRecord[], emptyCarCheckedAt: Date | null = null): KhatRunTrip {
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
        child: s.childRef ? { childRef: s.childRef, firstName: names[s.childRef]?.firstName ?? '—', photoUrl: names[s.childRef]?.photoUrl ?? null } : null,
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
export class KhatService implements KhatPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KhatService.name);
  private readonly offs: Array<() => void> = [];

  constructor(
    @Inject(KHAT_REPOSITORY) private readonly repo: KhatRepository,
    private readonly trips: TripsService,
    private readonly identity: IdentityService,
    private readonly dispatch: DispatchService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(KHAT_CALLS) private readonly calls: CallBridgePort | null = null,
    @Optional() @Inject(KHAT_QUEUE) private readonly queue: Queue<SweepCheckJob> | null = null,
    @Optional() @Inject(KHAT_CONFIG) private readonly config: KhatConfig = DEFAULT_KHAT_CONFIG,
    /** Child photos (Ali, 2026-10-06); absent in harnesses that don't need them (no photos then). */
    @Optional() @Inject(KHAT_PHOTOS) private readonly photos: KhatPhotosPort | null = null,
  ) {}

  /**
   * The children on runs this driver drives, by childRef: first name and the guardian's photo (signed).
   * Callers pass only refs of runs that are his (`trips.forDriver` / `ownRun`): identity logs each read.
   */
  private async runChildren(driverId: string, refs: readonly string[]): Promise<Record<string, RunChild>> {
    if (refs.length === 0) return {};
    const cards = await this.identity.childCardsForRun(driverId, refs);
    return Object.fromEntries(Object.entries(cards).map(([ref, c]) => [ref, { firstName: c.firstName, photoUrl: c.photoRef && this.photos ? this.photos.readUrl(c.photoRef) : null }]));
  }

  // ───────────────────────── guardian: a child's photo ─────────────────────────

  private guardianChild(c: { childRef: string; name: string; photoRef: string | null }): GuardianChild {
    return { childRef: c.childRef, name: c.name, photoUrl: c.photoRef && this.photos ? this.photos.readUrl(c.photoRef) : null };
  }

  async guardianChildren(actor: Actor): Promise<GuardianChild[]> {
    return (await this.identity.childrenWithPhotos(actor.personId)).map((c) => this.guardianChild(c));
  }

  /** The guardian adds (or replaces) his child's photo; the replaced photo's bytes are deleted. */
  async setChildPhoto(actor: Actor, input: SetChildPhotoInput): Promise<GuardianChild> {
    if (!this.photos || !(await this.photos.owns(input.uploadId, actor.personId))) throw new DriverError('upload_invalid');
    const { previousRef } = await this.identity.setChildPhoto(actor.personId, input.childRef, input.uploadId);
    if (previousRef && previousRef !== input.uploadId) await this.removeBytes(previousRef);
    return this.ownChild(actor, input.childRef);
  }

  /** The guardian removes the photo: gone from the vault and from storage; drivers see the initial again. */
  async removeChildPhoto(actor: Actor, input: RemoveChildPhotoInput): Promise<GuardianChild> {
    const { previousRef } = await this.identity.setChildPhoto(actor.personId, input.childRef, null);
    if (previousRef) await this.removeBytes(previousRef);
    return this.ownChild(actor, input.childRef);
  }

  private async ownChild(actor: Actor, childRef: string): Promise<GuardianChild> {
    const c = (await this.identity.childrenWithPhotos(actor.personId)).find((x) => x.childRef === childRef);
    if (!c) throw new DriverError('not_found');
    return this.guardianChild(c);
  }

  private async removeBytes(ref: string): Promise<void> {
    try {
      await this.photos?.remove(ref);
    } catch (err) {
      // The vault no longer points at it; a leftover object is unreachable (no signed URL is ever made).
      this.logger.warn(`child photo ${ref} not deleted: ${(err as Error).message}`);
    }
  }

  /**
   * The sweep timer (Ali, 2026-10-06): the queue runs `checkSweep` when a run's grace is over. Taps
   * and absences through this service arm it directly; the outbox subscriber arms it for anything
   * that settles a run another way (a stop completed through trips, a redelivered event).
   */
  onModuleInit(): void {
    this.queue?.process(async (job) => {
      if (job.name === SWEEP_CHECK_JOB) await this.checkSweep(job.data.tripId);
    });
    this.offs.push(
      this.events.subscribe(SWEEP_TIMER_SUBSCRIBER, ['khat.child_tapped_out', 'khat.absence_reported'], async (e) => {
        if (e.tripId) await this.armSweepTimer(e.tripId);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
  }

  /**
   * Today's runs. A run completes with its last drop-off, but it stays listed until the driver has
   * confirmed the car is empty, so the sweep is still there after an app restart or when the
   * reminder push opens the app (Ali, 2026-10-06).
   */
  async todayRun(actor: Actor, input: { date?: Date | undefined }): Promise<TodayRunView> {
    const at = input.date ?? this.clock.now();
    const localDate = localDateKey(at);
    const isToday = (t: Trip) => t.vertical === 'khat' && !DONE_TRIP_STATES.has(t.state) && localDateKey(runAt(t)) === localDate;
    const going = (await this.trips.forDriver(actor.personId)).filter(isToday);
    const finished = (await this.trips.completedForDriver(actor.personId, new Date(at.getTime() - DAY_MS))).filter(isToday);
    const finishedSwept = await Promise.all(finished.map((t) => this.emptyCarCheckedAt(t.id)));
    const trips = [...going, ...finished.filter((t, i) => !finishedSwept[i] && !going.some((g) => g.id === t.id))];
    trips.sort((a, b) => runAt(a).getTime() - runAt(b).getTime());
    const refs = trips.flatMap((t) => t.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r)));
    const names = await this.runChildren(actor.personId, refs);
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
      await this.clearSweepAlert(trip.id, now);
    }
    return this.view(actor, trip);
  }

  // ───────────────────────── the late sweep (Ali, 2026-10-06) ─────────────────────────

  /**
   * Schedules the run's sweep check for `sweepAlertAfterMin` after its last child stop settled.
   * Idempotent (one job id per run end); a no-op while a child stop is open or once swept.
   */
  async armSweepTimer(tripId: string): Promise<void> {
    if (!this.queue) return;
    const trip = await this.trips.get(tripId);
    if (trip.vertical !== 'khat') return;
    const endedAt = runEndedAt(trip, await this.repo.absencesForTrips([trip.id]));
    if (!endedAt || (await this.emptyCarCheckedAt(trip.id))) return;
    const dueAt = endedAt.getTime() + this.config.sweepAlertAfterMin * 60_000;
    await this.queue.add(SWEEP_CHECK_JOB, { tripId: trip.id }, { delayMs: Math.max(0, dueAt - this.clock.now().getTime()), jobId: jobKey('khat', 'sweep', trip.id, dueAt) });
  }

  /**
   * The timer's check: the run ended `sweepAlertAfterMin` ago and the driver has not confirmed the
   * car is empty → one `khat_sweep_alerts` row (the Console strip) and `khat.sweep_missed` (the
   * driver's reminder push), once per run. Runs where no child ever got in are left alone.
   */
  async checkSweep(tripId: string): Promise<SweepCheckOutcome> {
    const trip = await this.trips.get(tripId);
    if (trip.vertical !== 'khat' || !trip.courierId || DONE_TRIP_STATES.has(trip.state)) return 'not_applicable';
    const absences = await this.repo.absencesForTrips([trip.id]);
    const endedAt = runEndedAt(trip, absences);
    if (!endedAt || !trip.stops.some((s) => s.childTapInAt)) return 'not_applicable';
    if (await this.emptyCarCheckedAt(trip.id)) return 'swept';
    const now = this.clock.now();
    if (now.getTime() < endedAt.getTime() + this.config.sweepAlertAfterMin * 60_000) {
      await this.armSweepTimer(trip.id);
      return 'not_due';
    }
    if (await this.repo.sweepAlertForTrip(trip.id)) return 'already';
    const view = runTripView(trip, {}, absences);
    const drop = lastDrop(trip);
    const driverId = trip.courierId;
    const raise = () => this.uow.run(async (tx) => {
      const { alert, created } = await this.repo.raiseSweepAlert(
        { tripId: trip.id, cityId: trip.cityId, driverId, childrenTotal: view.childrenTotal, lastDropAt: drop.at, lastDropZone: drop.zoneKey, runEndedAt: endedAt, raisedAt: now },
        tx,
      );
      if (!created) return false;
      await this.events.emit(
        tx,
        {
          actorId: 'system',
          type: SWEEP_MISSED_EVENT,
          occurredAt: now,
          tripId: trip.id,
          idempotencyKey: `khat:sweep_missed:${trip.id}`,
          payload: { alertId: alert.id, tripId: trip.id, driverId, cityId: trip.cityId, runEndedAt: endedAt.toISOString(), lastDropAt: drop.at?.toISOString() ?? null, afterMin: this.config.sweepAlertAfterMin },
        },
        { name: 'trip', id: trip.id },
      );
      return true;
    });
    let raised: boolean;
    try {
      raised = await raise();
    } catch (err) {
      // Another instance raised it in the same moment (unique trip_id rolled this one back).
      if (await this.repo.sweepAlertForTrip(trip.id)) return 'already';
      throw err;
    }
    if (!raised) return 'already';
    // The driver may have slid "تأكدت" while the alert was being written: clear it at once.
    const swept = await this.emptyCarCheckedAt(trip.id);
    if (swept) await this.clearSweepAlert(trip.id, swept);
    return 'raised';
  }

  /** The driver's (late) confirm clears the run's alert, once; the Console shows "تأكد متأخر n دقيقة". */
  private async clearSweepAlert(tripId: string, at: Date): Promise<void> {
    const before = await this.repo.sweepAlertForTrip(tripId);
    if (!before || before.confirmedAt) return;
    const after = await this.repo.confirmSweepAlert(tripId, at);
    if (!after?.confirmedAt) return;
    await this.events.emit(
      undefined,
      {
        actorId: after.driverId,
        type: SWEEP_CLEARED_EVENT,
        occurredAt: after.confirmedAt,
        tripId,
        idempotencyKey: `khat:sweep_cleared:${tripId}`,
        payload: { alertId: after.id, tripId, driverId: after.driverId, lateMin: lateMinutes(after) },
      },
      { name: 'trip', id: tripId },
    );
  }

  /**
   * The Console safety strip: the city's open sweep alerts of the last `sweepOpenShowHours` and the
   * ones confirmed late in the last `sweepClearedShowMin`. The drivers' names and masked numbers are
   * one logged vault read for the staff member asking.
   */
  async sweepAlerts(actor: Actor, input: KhatSweepAlertsInput): Promise<KhatSweepAlert[]> {
    const now = this.clock.now().getTime();
    const rows = (await this.repo.sweepAlertsSince(input.cityId, new Date(now - KHAT_RULES.sweepOpenShowHours * 3_600_000))).filter(
      (r) => !r.confirmedAt || now - r.confirmedAt.getTime() <= KHAT_RULES.sweepClearedShowMin * 60_000,
    );
    if (rows.length === 0) return [];
    const cards = await this.identity.memberCards([...new Set(rows.map((r) => r.driverId))], actor.personId, 'khat_sweep_alert');
    const open = rows.filter((r) => !r.confirmedAt);
    const cleared = rows.filter((r) => r.confirmedAt).sort((a, b) => b.confirmedAt!.getTime() - a.confirmedAt!.getTime());
    return [...open, ...cleared].map((r) => sweepAlertView(r, cards[r.driverId] ?? null));
  }

  /** The strip's call button: a masked call from the staff member to the run's driver (on the run's timeline). */
  async callSweepDriver(actor: Actor, input: KhatSweepCallInput): Promise<SafetyCallSession> {
    const alert = await this.repo.sweepAlert(input.alertId);
    if (!alert) throw new DriverError('not_found');
    if (!this.calls) throw new DriverError('call_unavailable');
    const now = this.clock.now();
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const session = await this.calls.open({ callId, orderId: alert.tripId, callerId: actor.personId, calleeId: alert.driverId }, now);
    await this.events.emit(
      undefined,
      { actorId: actor.personId, type: 'khat.sweep_call_requested', occurredAt: now, tripId: alert.tripId, payload: { alertId: alert.id, tripId: alert.tripId, callId, mode: session.mode } },
      { name: 'trip', id: alert.tripId },
    );
    return { mode: session.mode, dial: session.dial, expiresAt: session.expiresAt };
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
    if (tap === 'out') await this.armSweepTimerSafely(trip.id);
    return this.view(actor, after);
  }

  private async view(actor: Actor, trip: Trip): Promise<KhatRunTrip> {
    const refs = trip.stops.map((s) => s.childRef).filter((r): r is string => Boolean(r));
    const names = await this.runChildren(actor.personId, refs);
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
    const view = await this.uow.run(async (tx) => {
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
    await this.armSweepTimerSafely(trip.id);
    return view;
  }

  /** The tap or the absence is saved whatever happens to the timer (the outbox subscriber re-arms it). */
  private async armSweepTimerSafely(tripId: string): Promise<void> {
    try {
      await this.armSweepTimer(tripId);
    } catch (err) {
      this.logger.warn(`sweep timer for ${tripId}: ${(err as Error).message}`);
    }
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

/** Whole minutes from the run's end to the driver's late confirm. */
function lateMinutes(r: SweepAlertRecord): number | null {
  return r.confirmedAt ? Math.max(0, Math.floor((r.confirmedAt.getTime() - r.runEndedAt.getTime()) / 60_000)) : null;
}

function sweepAlertView(r: SweepAlertRecord, card: { name: string | null; phoneMasked: string } | null): KhatSweepAlert {
  return {
    alertId: r.id,
    tripId: r.tripId,
    cityId: r.cityId,
    driver: { personId: r.driverId, displayName: card?.name ? shortDisplayName(card.name) || null : null, phoneMasked: card?.phoneMasked ?? null },
    childrenTotal: r.childrenTotal,
    lastDropAt: r.lastDropAt,
    lastDropZone: r.lastDropZone,
    runEndedAt: r.runEndedAt,
    raisedAt: r.raisedAt,
    confirmedAt: r.confirmedAt,
    confirmedLateMin: lateMinutes(r),
  };
}

function absenceView(r: AbsenceRecord): AbsenceView {
  return { absenceId: r.id, tripId: r.tripId, childRef: r.childRef, reason: r.reason, skippedStopIds: [...r.skippedStopIds], reportedAt: r.createdAt };
}
