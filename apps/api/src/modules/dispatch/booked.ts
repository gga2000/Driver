import { DriverError, type BookedRideState } from '@driver/contracts';

/**
 * Evening-before booked rides (edge-case review #28): the pre-assignment of one ride booked for later,
 * kept on its dispatch request (`DispatchRequest.booked`, Redis JSON). Pure: the orchestrator applies
 * these steps under its locks and timers and emits the events.
 *
 *   waiting ──open──▶ offered ──confirm──▶ confirmed ──remind (T−60)──▶ reminded ──start──▶ started
 *                        │  ▲                  │                          │
 *              deadline  │  └──release before the deadline (he can't take it again)
 *                        ▼                     └──── release after it / no-show at T−30 ──▶ released
 *                   unconfirmed
 *   any open state ──cancel──▶ cancelled
 *
 * `unconfirmed` and `released` mean the normal search starts at T−30 (the fallback); `started` means the
 * confirmed driver has the trip. At most one driver holds it at any time.
 */
export type BookedJobState = 'waiting' | 'offered' | 'confirmed' | 'reminded' | 'started' | 'unconfirmed' | 'released' | 'cancelled';

export interface BookedJob {
  orderId: string;
  scheduledFor: number;
  /** When drivers may first confirm it (the evening before at 18:00, or at booking). */
  offerAt: number;
  /** Drivers confirm by this time (22:00 the evening before; same-day: 90 min before). */
  confirmBy: number;
  /** The rider's favourite (driver id): until `favouriteUntil` the job is his alone. */
  favouriteId: string | null;
  favouriteUntil: number;
  /** When it opened to every fitting driver (their push); null while the favourite has it, or before. */
  openedAt: number | null;
  state: BookedJobState;
  /** The confirmed driver (confirmed, reminded, started). */
  driverId: string | null;
  confirmedAt: number | null;
  /** Said «مو إلي»: not shown to them again. */
  passedBy: string[];
  /** Dropped it or didn't show: never offered it again. */
  releasedBy: string[];
}

export type BookedEvent =
  | { kind: 'open' }
  | { kind: 'open_to_all' }
  | { kind: 'pass'; driverId: string }
  | { kind: 'confirm'; driverId: string }
  | { kind: 'deadline' }
  | { kind: 'remind' }
  | { kind: 'release'; driverId: string }
  | { kind: 'no_show' }
  | { kind: 'start'; driverId: string }
  | { kind: 'cancel' };

const HOLDING: ReadonlySet<BookedJobState> = new Set(['confirmed', 'reminded']);
const OVER: ReadonlySet<BookedJobState> = new Set(['started', 'unconfirmed', 'released', 'cancelled']);

/** A new pre-assignment, waiting for its offer time. */
export function newBookedJob(input: { orderId: string; scheduledFor: number; offerAt: number; confirmBy: number; favouriteId: string | null; favouriteUntil: number }): BookedJob {
  return {
    ...input,
    favouriteUntil: input.favouriteId ? input.favouriteUntil : input.offerAt,
    openedAt: null,
    state: 'waiting',
    driverId: null,
    confirmedAt: null,
    passedBy: [],
    releasedBy: [],
  };
}

/** The confirmed driver holds it (and may start it). */
export function isHeld(job: BookedJob): boolean {
  return HOLDING.has(job.state);
}

/** True while the favourite has the job to himself. */
export function favouriteOnly(job: BookedJob, at: number): boolean {
  return job.favouriteId !== null && job.openedAt === null && at < job.favouriteUntil;
}

/**
 * Whether this driver may see and confirm the job now (vehicle and cap fit are dispatch's own check):
 * on offer, inside its window, not passed or dropped by him, and only the favourite in his time.
 */
export function openTo(job: BookedJob, driverId: string, at: number): boolean {
  if (job.state !== 'offered' || at < job.offerAt || at >= job.confirmBy) return false;
  if (job.passedBy.includes(driverId) || job.releasedBy.includes(driverId)) return false;
  return !favouriteOnly(job, at) || driverId === job.favouriteId;
}

/** One step of the machine at time `at`. Refusals are `DriverError`s the Partner app explains. */
export function bookedStep(job: BookedJob, ev: BookedEvent, at: number): BookedJob {
  switch (ev.kind) {
    case 'open':
      if (job.state !== 'waiting') return job;
      return { ...job, state: 'offered', openedAt: job.favouriteId && at < job.favouriteUntil ? null : at };
    case 'open_to_all':
      if (job.state !== 'offered' || job.openedAt !== null) return job;
      return { ...job, openedAt: at, favouriteUntil: Math.min(job.favouriteUntil, at) };
    case 'pass': {
      if (job.state !== 'offered') return job;
      const passedBy = job.passedBy.includes(ev.driverId) ? job.passedBy : [...job.passedBy, ev.driverId];
      // The favourite said no: everyone may have it now.
      if (ev.driverId === job.favouriteId && job.openedAt === null) return { ...job, passedBy, openedAt: at, favouriteUntil: Math.min(job.favouriteUntil, at) };
      return { ...job, passedBy };
    }
    case 'confirm': {
      if (isHeld(job)) {
        if (job.driverId === ev.driverId) return job;
        throw new DriverError('booked_job_taken');
      }
      if (job.state !== 'offered' || at >= job.confirmBy || job.releasedBy.includes(ev.driverId)) throw new DriverError('booked_job_closed');
      if (at < job.offerAt || (favouriteOnly(job, at) && ev.driverId !== job.favouriteId)) throw new DriverError('booked_job_not_found');
      return { ...job, state: 'confirmed', driverId: ev.driverId, confirmedAt: at, passedBy: job.passedBy.filter((d) => d !== ev.driverId) };
    }
    case 'deadline':
      if (job.state !== 'waiting' && job.state !== 'offered') return job;
      return { ...job, state: 'unconfirmed' };
    case 'remind':
      if (job.state !== 'confirmed') return job;
      return { ...job, state: 'reminded' };
    case 'release': {
      if (!isHeld(job) || job.driverId !== ev.driverId) throw new DriverError('booked_job_not_found');
      const releasedBy = [...job.releasedBy, ev.driverId];
      // Before the deadline the others may still take it; after it, the fallback search at T−30.
      if (at < job.confirmBy) return { ...job, state: 'offered', driverId: null, confirmedAt: null, releasedBy, openedAt: job.openedAt ?? at, favouriteUntil: Math.min(job.favouriteUntil, at) };
      return { ...job, state: 'released', driverId: null, releasedBy };
    }
    case 'no_show': {
      if (!isHeld(job) || job.driverId === null) return job;
      return { ...job, state: 'released', driverId: null, releasedBy: [...job.releasedBy, job.driverId] };
    }
    case 'start':
      if (job.state === 'started' && job.driverId === ev.driverId) return job;
      if (!isHeld(job) || job.driverId !== ev.driverId) throw new DriverError('booked_job_not_found');
      return { ...job, state: 'started' };
    case 'cancel':
      if (OVER.has(job.state) && job.state !== 'unconfirmed' && job.state !== 'released') return job;
      return { ...job, state: 'cancelled' };
  }
}

/** What the rider is told (`rideHabits.bookedRide`): a driver holds it, drivers are being asked, or the T−30 search. */
export function riderState(job: BookedJob | null | undefined): BookedRideState {
  if (!job) return 'later';
  if (isHeld(job) || job.state === 'started') return 'confirmed';
  if (job.state === 'waiting' || job.state === 'offered') return 'looking';
  return 'later';
}
