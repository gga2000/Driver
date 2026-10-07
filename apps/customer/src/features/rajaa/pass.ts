import type { BookingView } from '@driver/contracts';
import { haversineM, isBoardingOpen, type LatLngLike } from './logic';

/**
 * Where a boarding pass is in its life (joy r3, audit S-2): before boarding (countdown), boarding
 * open at the garage (PIN up front, live car), on the road (checked in or the car left), and kept
 * after the trip (a stub you can look back at). Cancelled, moved, expired and no-show bookings have no
 * pass life of their own: `closed`.
 */
export type PassPhase = 'before' | 'boarding' | 'onboard' | 'kept' | 'closed';

export function passPhase(b: Pick<BookingView, 'state'> & { departure: Pick<BookingView['departure'], 'state' | 'departAt'> }, now: Date): PassPhase {
  if (b.state === 'completed') return 'kept';
  if (b.state === 'checked_in' || (b.state === 'booked' && b.departure.state === 'departed')) return 'onboard';
  if (b.state !== 'booked' && b.state !== 'held') return 'closed';
  return b.departure.state === 'boarding' || isBoardingOpen(b.departure.departAt, now) ? 'boarding' : 'before';
}

const MIN = 60_000;

/**
 * Leave-home time (idea t4): how long the ride from home to the garage takes in town, and when to
 * leave so the rider is at the garage 10 minutes before the car (cash keeps a seat only 3 minutes).
 * An estimate from the straight line (×1.35 for the streets, 25 km/h in Aziziyah, 5 minutes to find
 * a tuktuk), never below 5 minutes; the copy says «حوالي».
 */
export const LEAVE_HOME = { roadFactor: 1.35, kmh: 25, pickupMin: 5, earlyMin: 10, minRideMin: 5 } as const;

export function leaveHome(home: LatLngLike, garage: LatLngLike, departAt: Date): { rideMin: number; leaveAt: Date; arriveBy: Date } {
  const km = (haversineM(home, garage) / 1000) * LEAVE_HOME.roadFactor;
  const rideMin = Math.max(LEAVE_HOME.minRideMin, Math.ceil((km / LEAVE_HOME.kmh) * 60) + LEAVE_HOME.pickupMin);
  const arriveBy = new Date(departAt.getTime() - LEAVE_HOME.earlyMin * MIN);
  return { rideMin, arriveBy, leaveAt: new Date(arriveBy.getTime() - rideMin * MIN) };
}

export type LateStage = 'grace' | 'meter' | 'gone';
export type LateSegment = { stage: LateStage; from: Date; to: Date | null };

/**
 * The late bar (idea t6): what happens if the rider is late, as stages with their times. Wallet:
 * grace, then the meter until the cap, then the car leaves (the seat moves to the next car). Cash:
 * grace, then the driver may leave. `to` is null on the last, open-ended stage.
 */
export function lateStages(departAt: Date, prepaid: boolean, graceMs: number, meterCapMin: number): LateSegment[] {
  const graceEnd = new Date(departAt.getTime() + graceMs);
  if (!prepaid) return [{ stage: 'grace', from: departAt, to: graceEnd }, { stage: 'gone', from: graceEnd, to: null }];
  const capEnd = new Date(departAt.getTime() + meterCapMin * MIN);
  return [
    { stage: 'grace', from: departAt, to: graceEnd },
    { stage: 'meter', from: graceEnd, to: capEnd },
    { stage: 'gone', from: capEnd, to: null },
  ];
}

/** Which stage `now` is in, or null before the leave time. */
export function lateStageAt(stages: readonly LateSegment[], now: Date): LateStage | null {
  const s = stages.find((x) => now >= x.from && (x.to === null || now < x.to));
  return s?.stage ?? null;
}
