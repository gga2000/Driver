import { haversineMeters } from '../trips/index.js';
import type { CorridorConfig } from './intercity.config.js';
import type { BookingRecord, DepartureRecord } from './model.js';

/**
 * The garage late meter, computed on the server from server-received fixes and taps (decisions §8,
 * review C-38/39). Pure: the caller passes the records and the time.
 *
 * Rider meter — reference: the announced departure time. It runs only while the driver is checked in
 * inside the 150 m garage geofence AND at least one other rider has checked in; it starts at the
 * latest of (announced time, driver's check-in fix, first other rider's check-in) and stops at the
 * rider's own check-in (or, frozen, at the driver's first fix outside the geofence before departing).
 * It applies to garage pickups on prepaid or trusted seats only; cash reservations get a plain
 * 3-minute grace and no meter (domain §2). The ledger turns minutes into blocks (5-min grace,
 * 1,000 / 10 min to the driver, 500 / 10 min to each waiting rider, 20-min cap).
 *
 * Driver meter — at the garage departure only: minutes from the announced time to the driver's
 * check-in fix (waived when his trail stopped inside a seeded checkpoint geofence), plus minutes the
 * car sat past its hard latest departure with riders on board.
 */

const MIN = 60_000;

function maxTime(...ds: Date[]): Date {
  return new Date(Math.max(...ds.map((d) => d.getTime())));
}

/** The rider meter applies to this booking at all (garage pickup, prepaid or trusted). */
export function meterApplies(b: BookingRecord): boolean {
  return b.pickup.kind === 'garage' && (b.prepaid || b.trusted);
}

/** When the meter for `b` started, or null when it is not running (yet). */
export function riderMeterStart(
  dep: DepartureRecord,
  bookings: readonly BookingRecord[],
  b: BookingRecord,
): Date | null {
  if (!meterApplies(b)) return null;
  const ci = dep.driverCheckIn;
  if (!ci) return null;
  const others = bookings
    .filter((o) => o.id !== b.id && o.checkedInAt !== null)
    .map((o) => o.checkedInAt!.getTime());
  if (others.length === 0) return null;
  return maxTime(dep.departAt, ci.at, new Date(Math.min(...others)));
}

/** Whole minutes on the rider's meter at `at` (stopped at their check-in); null when it is not running. */
export function riderMeterMinutes(
  dep: DepartureRecord,
  bookings: readonly BookingRecord[],
  b: BookingRecord,
  at: Date,
): number | null {
  const start = riderMeterStart(dep, bookings, b);
  if (!start) return null;
  let end = b.checkedInAt ?? at;
  if (dep.driverLeftGeofenceAt && dep.driverLeftGeofenceAt.getTime() < end.getTime())
    end = dep.driverLeftGeofenceAt;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return b.checkedInAt ? 0 : null;
  return Math.floor(ms / MIN);
}

/**
 * Hook deciding whether the driver's arrival lateness is waived (review C-39: a stop inside a known
 * checkpoint geofence on the way to the garage). Bound per corridor; tests may swap it.
 */
export interface CheckpointWaiver {
  waives(dep: DepartureRecord, corridor: CorridorConfig): boolean;
}

/** Default waiver: any trail fix inside a corridor checkpoint before the driver checked in at the garage. */
export class TrailCheckpointWaiver implements CheckpointWaiver {
  waives(dep: DepartureRecord, corridor: CorridorConfig): boolean {
    const until = dep.driverCheckIn?.at.getTime() ?? Number.POSITIVE_INFINITY;
    return dep.trail.some(
      (f) =>
        f.at.getTime() <= until &&
        corridor.checkpoints.some((c) => haversineMeters(f, c) <= c.radiusM),
    );
  }
}

export interface DriverMeter {
  /** Late arrival at the garage after the announced time (0 when waived or unknown). */
  arrivalMin: number;
  /** Sitting past the hard latest departure. */
  pastLatestMin: number;
  waived: boolean;
  minutes: number;
}

/** The driver's garage meter at departure time `departedAt`. */
export function driverMeter(dep: DepartureRecord, departedAt: Date, waived: boolean): DriverMeter {
  const ci = dep.driverCheckIn;
  const arrivalMs = ci ? Math.max(0, ci.at.getTime() - dep.departAt.getTime()) : 0;
  const latestRef = maxTime(dep.latestDepartureAt, ci?.at ?? dep.departAt);
  const pastLatestMs = Math.max(0, departedAt.getTime() - latestRef.getTime());
  const arrivalMin = waived ? 0 : Math.floor(arrivalMs / MIN);
  const pastLatestMin = Math.floor(pastLatestMs / MIN);
  return {
    arrivalMin,
    pastLatestMin,
    waived: waived && arrivalMs > 0,
    minutes: arrivalMin + pastLatestMin,
  };
}

/**
 * x3: until when a garage rider's seat is held because our taxi bringing him runs late — the taxi's
 * expected arrival, capped at `capMin` after the announced time (the late meter's cap); null when the
 * hold is off, he has no late taxi, or he is not a garage pickup. Pure.
 */
export function seatHoldUntil(dep: DepartureRecord, b: BookingRecord, capMin: number, on: boolean): Date | null {
  if (!on || b.pickup.kind !== 'garage' || !b.taxiLateUntil) return null;
  const cap = dep.departAt.getTime() + capMin * MIN;
  return new Date(Math.min(b.taxiLateUntil.getTime(), cap));
}
