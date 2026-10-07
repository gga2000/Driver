import type {
  BookingState,
  DemandPostState,
  IntercityDepartureState,
  IntercityDirection,
  RequestState,
} from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { FINISHED_RUN, type BookingRecord, type DemandPostRecord, type DepartureRecord, type PinAttemptRecord, type RequestRecord } from './model.js';

/**
 * Persistence of the routes module: departures (with their run state), seat bookings, demand posts
 * and request-board posts. Only this module reads or writes these rows. `save*` is an upsert of the
 * whole record; the service serialises every write under one lock (`lock`), so there is no
 * compare-and-set here.
 */
export interface DepartureFilter {
  garageId?: string;
  corridorId?: string;
  direction?: IntercityDirection;
  fromCityId?: string;
  driverId?: string;
  states?: readonly IntercityDepartureState[];
  /** departAt ≥ from */
  from?: Date;
  /** departAt ≤ to */
  to?: Date;
}

export interface DemandFilter {
  corridorId?: string;
  direction?: IntercityDirection;
  riderId?: string;
  states?: readonly DemandPostState[];
  /** windowEnd > after */
  endsAfter?: Date;
  /** windowStart < before */
  startsBefore?: Date;
}

export interface RequestFilter {
  riderId?: string;
  states?: readonly RequestState[];
}

export interface RiderRecordStats {
  completedBookings: number;
  /** Cash no-shows plus lapsed demand claims (review C-34). */
  cashStrikes: number;
}

/** A driver's track record (the rider-facing profile, x12–x17). */
export interface DriverRecord {
  /** His finished runs (arrived or closed), oldest first. */
  runs: DepartureRecord[];
  /** Rated bookings on his runs, oldest rating first. */
  rated: BookingRecord[];
}

export interface ReviewFilter {
  /** true: only hidden; false: only shown; undefined: both. */
  hidden?: boolean;
  /** Written before this (paging). */
  before?: Date;
  limit: number;
}

export interface RoutesRepository {
  saveDeparture(d: DepartureRecord, tx?: Tx): Promise<void>;
  getDeparture(id: string, tx?: Tx): Promise<DepartureRecord | null>;
  listDepartures(f: DepartureFilter, tx?: Tx): Promise<DepartureRecord[]>;

  saveBooking(b: BookingRecord, tx?: Tx): Promise<void>;
  getBooking(id: string, tx?: Tx): Promise<BookingRecord | null>;
  bookingsFor(departureId: string, tx?: Tx): Promise<BookingRecord[]>;
  bookingsOfRider(
    riderId: string,
    states?: readonly BookingState[],
    tx?: Tx,
  ): Promise<BookingRecord[]>;
  riderStats(riderId: string, tx?: Tx): Promise<RiderRecordStats>;
  driverRecord(driverId: string, tx?: Tx): Promise<DriverRecord>;
  /** Bookings with a written review, newest review first. */
  reviews(f: ReviewFilter, tx?: Tx): Promise<BookingRecord[]>;

  saveDemand(p: DemandPostRecord, tx?: Tx): Promise<void>;
  getDemand(id: string, tx?: Tx): Promise<DemandPostRecord | null>;
  listDemand(f: DemandFilter, tx?: Tx): Promise<DemandPostRecord[]>;

  saveRequest(r: RequestRecord, tx?: Tx): Promise<void>;
  getRequest(id: string, tx?: Tx): Promise<RequestRecord | null>;
  listRequests(f: RequestFilter, tx?: Tx): Promise<RequestRecord[]>;

  /** Appends one seat-PIN attempt (the log is never updated or deleted). */
  addPinAttempt(a: PinAttemptRecord, tx?: Tx): Promise<void>;
  /** A departure's PIN attempts, oldest first. */
  pinAttemptsFor(departureId: string, tx?: Tx): Promise<PinAttemptRecord[]>;
  /** The city's attempts that raised an ops alert at or after `since`, newest first. */
  pinAlertsSince(cityId: string, since: Date, tx?: Tx): Promise<PinAttemptRecord[]>;
  getPinAttempt(id: string, tx?: Tx): Promise<PinAttemptRecord | null>;

  /** Cross-instance write lock held until `tx` ends (Postgres advisory lock); a no-op in memory. */
  lock(tx?: Tx): Promise<void>;
}

export const ROUTES_REPOSITORY = Symbol('ROUTES_REPOSITORY');

// ───────────────────────── in memory ─────────────────────────

const clone = <T>(x: T): T => structuredClone(x);

export class InMemoryRoutesRepository implements RoutesRepository {
  private readonly departures = new Map<string, DepartureRecord>();
  private readonly bookings = new Map<string, BookingRecord>();
  private readonly demand = new Map<string, DemandPostRecord>();
  private readonly requests = new Map<string, RequestRecord>();
  private readonly pinAttempts: PinAttemptRecord[] = [];

  async saveDeparture(d: DepartureRecord): Promise<void> {
    this.departures.set(d.id, clone(d));
  }

  async getDeparture(id: string): Promise<DepartureRecord | null> {
    const d = this.departures.get(id);
    return d ? clone(d) : null;
  }

  async listDepartures(f: DepartureFilter): Promise<DepartureRecord[]> {
    return [...this.departures.values()]
      .filter(
        (d) =>
          (!f.garageId || d.garageId === f.garageId) &&
          (!f.corridorId || d.corridorId === f.corridorId) &&
          (!f.direction || d.direction === f.direction) &&
          (!f.fromCityId || d.fromCityId === f.fromCityId) &&
          (!f.driverId || d.driverId === f.driverId) &&
          (!f.states || f.states.includes(d.state)) &&
          (!f.from || d.departAt.getTime() >= f.from.getTime()) &&
          (!f.to || d.departAt.getTime() <= f.to.getTime()),
      )
      .sort(
        (a, b) =>
          a.departAt.getTime() - b.departAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(clone);
  }

  async saveBooking(b: BookingRecord): Promise<void> {
    this.bookings.set(b.id, clone(b));
  }

  async getBooking(id: string): Promise<BookingRecord | null> {
    const b = this.bookings.get(id);
    return b ? clone(b) : null;
  }

  async bookingsFor(departureId: string): Promise<BookingRecord[]> {
    return [...this.bookings.values()]
      .filter((b) => b.departureId === departureId)
      .sort(byCreated)
      .map(clone);
  }

  async bookingsOfRider(
    riderId: string,
    states?: readonly BookingState[],
  ): Promise<BookingRecord[]> {
    return [...this.bookings.values()]
      .filter((b) => b.riderId === riderId && (!states || states.includes(b.state)))
      .sort(byCreated)
      .map(clone);
  }

  async riderStats(riderId: string): Promise<RiderRecordStats> {
    const mine = [...this.bookings.values()].filter((b) => b.riderId === riderId);
    return {
      completedBookings: mine.filter((b) => b.state === 'completed').length,
      cashStrikes: mine.filter((b) => isCashStrike(b)).length,
    };
  }

  async driverRecord(driverId: string): Promise<DriverRecord> {
    const runs = [...this.departures.values()]
      .filter((d) => d.driverId === driverId && FINISHED_RUN.includes(d.state))
      .sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
    const ids = new Set(runs.map((d) => d.id));
    const rated = [...this.bookings.values()]
      .filter((b) => ids.has(b.departureId) && b.rating)
      .sort((a, b) => a.rating!.at.getTime() - b.rating!.at.getTime());
    return { runs: runs.map(clone), rated: rated.map(clone) };
  }

  async reviews(f: ReviewFilter): Promise<BookingRecord[]> {
    return [...this.bookings.values()]
      .filter(
        (b) =>
          b.review &&
          (f.hidden === undefined || (b.review.hiddenAt !== null) === f.hidden) &&
          (!f.before || b.review.at.getTime() < f.before.getTime()),
      )
      .sort((a, b) => b.review!.at.getTime() - a.review!.at.getTime())
      .slice(0, f.limit)
      .map(clone);
  }

  async saveDemand(p: DemandPostRecord): Promise<void> {
    this.demand.set(p.id, clone(p));
  }

  async getDemand(id: string): Promise<DemandPostRecord | null> {
    const p = this.demand.get(id);
    return p ? clone(p) : null;
  }

  async listDemand(f: DemandFilter): Promise<DemandPostRecord[]> {
    return [...this.demand.values()]
      .filter(
        (p) =>
          (!f.corridorId || p.corridorId === f.corridorId) &&
          (!f.direction || p.direction === f.direction) &&
          (!f.riderId || p.riderId === f.riderId) &&
          (!f.states || f.states.includes(p.state)) &&
          (!f.endsAfter || p.windowEnd.getTime() > f.endsAfter.getTime()) &&
          (!f.startsBefore || p.windowStart.getTime() < f.startsBefore.getTime()),
      )
      .sort(
        (a, b) =>
          a.windowStart.getTime() - b.windowStart.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(clone);
  }

  async saveRequest(r: RequestRecord): Promise<void> {
    this.requests.set(r.id, clone(r));
  }

  async getRequest(id: string): Promise<RequestRecord | null> {
    const r = this.requests.get(id);
    return r ? clone(r) : null;
  }

  async listRequests(f: RequestFilter): Promise<RequestRecord[]> {
    return [...this.requests.values()]
      .filter(
        (r) => (!f.riderId || r.riderId === f.riderId) && (!f.states || f.states.includes(r.state)),
      )
      .sort(
        (a, b) =>
          a.when.getTime() - b.when.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(clone);
  }

  async addPinAttempt(a: PinAttemptRecord): Promise<void> {
    this.pinAttempts.push(clone(a));
  }

  async pinAttemptsFor(departureId: string): Promise<PinAttemptRecord[]> {
    return this.pinAttempts
      .filter((a) => a.departureId === departureId)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map(clone);
  }

  async pinAlertsSince(cityId: string, since: Date): Promise<PinAttemptRecord[]> {
    // Latest written first among equal times (the Prisma twin orders by created_at too).
    return [...this.pinAttempts]
      .reverse()
      .filter((a) => a.cityId === cityId && a.alert !== null && a.at.getTime() >= since.getTime())
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map(clone);
  }

  async getPinAttempt(id: string): Promise<PinAttemptRecord | null> {
    const a = this.pinAttempts.find((x) => x.id === id);
    return a ? clone(a) : null;
  }

  async lock(): Promise<void> {}
}

function byCreated(a: { createdAt: Date }, b: { createdAt: Date }): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** A strike against cash reservation rights: a cash no-show, or a demand claim left to lapse. */
export function isCashStrike(
  b: Pick<BookingRecord, 'state' | 'prepaid' | 'payment' | 'origin'>,
): boolean {
  if (b.state === 'no_show' && !b.prepaid && b.payment === 'cash') return true;
  return b.state === 'expired' && b.origin === 'demand_claim';
}
