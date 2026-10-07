import { z } from 'zod';
import { Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { RIDE_HABIT_RULES, rideScheduleProblem } from './ride-habits-io.js';

/**
 * Taxis linked to الرجعة seats (taxi ideas x2, x3, x4 + n10). Ali voted yes on all four:
 * - x2 «تكسي يلحگك على سيارة الرجعة»: after booking a seat on a car leaving an Aziziyah garage, a
 *   taxi timed so he is at the garage with time to spare (an ordinary ride booked for later).
 * - x3 «نخبر سايق الرجعة إذا تأخر التكسي»: when that taxi (ours) is running late so he would miss the
 *   car's time, the الرجعة driver and the rider hear it, with the minutes.
 * - x4 / n10 «تكسي ينتظرك بالكراج»: on his trip back to Aziziyah he arms a taxi; when the car is
 *   about ten minutes from the Aziziyah garage the server books it (garage → home), so the driver
 *   is there when he gets down. Priced by the server when it is booked, as every ride.
 * Nothing here changes a price or a fee; the x3 seat hold (below) changes the no-show rule only when switched on.
 */
/**
 * x3 seat hold (Ali 2026-10-07: "a main feature"): when our taxi to the garage runs late, the rider's
 * الرجعة seat waits for him (the driver can't mark him a no-show until the taxi is due, capped at the
 * late meter's cap). Off until Ali confirms the no-show rule and who pays the wait.
 */
export const RIDE_SEAT_HOLD = false;

export const GARAGE_TAXI_RULES = {
  /** x2: the taxi brings him to the garage this many minutes before the car's announced time. */
  bufferMin: 10,
  /**
   * x2: when the timed pickup is closer than a ride can be booked ahead (20 min), a ride now is
   * offered instead if it still makes it: the minutes a driver usually takes to reach a rider.
   */
  nowPickupMin: 7,
  /** x3: he and the الرجعة driver are told once the taxi would bring him at least this late. */
  lateTellMin: 3,
  /** x3: told again only when the lateness grew by this much since the last time. */
  lateRetellStepMin: 5,
  /** x4: the ride is booked when the car's live minutes to the Aziziyah garage come down to this. */
  placeAtEtaMin: 10,
  /** x4: a car fix older than this is not live; the ETA falls back to departure + the corridor's travel time. */
  freshFixMin: 5,
  /** x4: a car that arrived this long ago with the ride still not booked: the arm is dropped. */
  arrivedGraceMin: 15,
  /** How often the server looks at linked taxis and armed ones. */
  tickMs: 60_000,
} as const;

const MIN_MS = 60_000;
const GRID_MS = RIDE_HABIT_RULES.schedule.gridMin * MIN_MS;

/** How the taxi to the garage goes: booked for a time, a ride now, or it can't make the car any more. */
export type GaragePickupPlan = { mode: 'later'; pickupAt: Date; arriveAt: Date } | { mode: 'now'; arriveAt: Date } | { mode: 'too_late' };

/**
 * x2: the pickup time for a taxi that reaches the garage `bufferMin` before `departAt`, given the
 * learned ride minutes from his place to the garage — rounded down to the 5-minute grid of rides
 * booked for later. Closer than a ride can be booked ahead, a ride now when it still arrives by the
 * car's time (a driver's usual `nowPickupMin` + the ride); otherwise it is too late.
 */
export function garagePickupPlan(departAt: Date, rideMin: number, now: Date): GaragePickupPlan {
  const raw = departAt.getTime() - (GARAGE_TAXI_RULES.bufferMin + rideMin) * MIN_MS;
  const pickupAt = new Date(Math.floor(raw / GRID_MS) * GRID_MS);
  if (rideScheduleProblem(pickupAt, now) === null) return { mode: 'later', pickupAt, arriveAt: new Date(pickupAt.getTime() + rideMin * MIN_MS) };
  const arriveAt = new Date(now.getTime() + (GARAGE_TAXI_RULES.nowPickupMin + rideMin) * MIN_MS);
  return arriveAt.getTime() <= departAt.getTime() ? { mode: 'now', arriveAt } : { mode: 'too_late' };
}

/** x3: whole minutes he would reach the garage after the car's time (0 when on time). */
export function garageLateMin(arriveAt: Date, departAt: Date): number {
  return Math.max(0, Math.ceil((arriveAt.getTime() - departAt.getTime()) / MIN_MS));
}

/** x3: tell them now? The first time from `lateTellMin`, again only when it grew by `lateRetellStepMin`. */
export function shouldTellLate(lateMin: number, toldMin: number | null): boolean {
  if (lateMin < GARAGE_TAXI_RULES.lateTellMin) return false;
  return toldMin === null || lateMin >= toldMin + GARAGE_TAXI_RULES.lateRetellStepMin;
}

/**
 * x4: the car's minutes to the Aziziyah garage. A live fix (no older than `freshFixMin`) is routed
 * by the one ETA (`fixMin`, the caller's); without one, its departure + the corridor's travel time.
 * Null before it left.
 */
export function returnCarEtaMin(i: { now: Date; departedAt: Date | null; travelMin: number; fixAt: Date | null; fixMin: number | null }): number | null {
  if (i.fixAt && i.fixMin !== null && i.now.getTime() - i.fixAt.getTime() <= GARAGE_TAXI_RULES.freshFixMin * MIN_MS) return Math.max(0, i.fixMin);
  if (!i.departedAt) return null;
  return Math.max(0, Math.ceil((i.departedAt.getTime() + i.travelMin * MIN_MS - i.now.getTime()) / MIN_MS));
}

// ───────────────────────── views ─────────────────────────

export const GarageTaxiGarage = z.object({ id: z.string(), nameAr: z.string(), nameEn: z.string() });
export type GarageTaxiGarage = z.infer<typeof GarageTaxiGarage>;

/** One of his saved places the card offers (home first). */
export const GarageTaxiPlace = z.object({ id: z.string(), label: z.enum(['home', 'work', 'custom']), name: z.string(), zoneName_ar: z.string() });
export type GarageTaxiPlace = z.infer<typeof GarageTaxiPlace>;

/** Where the taxi starts (x2) or ends (x4): one of his saved places, or a pin the caller gives (x2). */
export const GarageTaxiEnd = z.union([z.object({ placeId: z.string().min(1).max(64) }), z.object({ pin: LatLng })]);
export type GarageTaxiEnd = z.infer<typeof GarageTaxiEnd>;

export const GarageTaxiPayment = z.enum(['cash', 'wallet']);
export type GarageTaxiPayment = z.infer<typeof GarageTaxiPayment>;

/** x2: why no taxi to the garage is offered for this seat. */
export const ToGarageUnavailable = z.enum(['not_from_aziziyah', 'not_booked', 'door_pickup', 'car_left', 'too_late', 'no_place']);
export type ToGarageUnavailable = z.infer<typeof ToGarageUnavailable>;

export const GarageTaxiInput = z.object({ bookingId: z.string().min(1) });
export const ToGarageInput = GarageTaxiInput.extend({ from: GarageTaxiEnd.optional() });
export type ToGarageInput = z.input<typeof ToGarageInput>;

/**
 * x2 «تكسي يلحگك على السيارة»: the plan for this seat. `offer` with the pickup time, the ride minutes
 * and the server's fare; `booked` once the ride is placed (its order and state); `unavailable` with why.
 */
export const ToGaragePlan = z.object({
  bookingId: z.string(),
  status: z.enum(['offer', 'booked', 'unavailable']),
  unavailable: ToGarageUnavailable.nullable(),
  garage: GarageTaxiGarage,
  /** The car's announced time (he should be at the garage by then). */
  departAt: z.coerce.date(),
  places: z.array(GarageTaxiPlace),
  /** The place the plan is for (null with a pin, or when he has none). */
  fromPlaceId: z.string().nullable(),
  fromName: z.string().nullable(),
  mode: z.enum(['later', 'now']).nullable(),
  /** `later`: when the taxi picks him up (a ride booked for later). */
  pickupAt: z.coerce.date().nullable(),
  /** When he is at the garage, by the plan. */
  arriveAt: z.coerce.date().nullable(),
  rideMin: z.number().int().nonnegative().nullable(),
  bufferMin: z.number().int(),
  /** The server's taxi fare for that time (what `bookToGarage` sends back), and what he pays. */
  fareIqd: Iqd.nullable(),
  totalIqd: Iqd.nullable(),
  paymentMethod: GarageTaxiPayment,
  order: z.object({ orderId: z.string(), state: z.string(), scheduledFor: z.coerce.date().nullable() }).nullable(),
});
export type ToGaragePlan = z.infer<typeof ToGaragePlan>;

export const BookToGarageInput = GarageTaxiInput.extend({
  from: GarageTaxiEnd.optional(),
  /** The fare the card showed; must equal the server's (`price_changed`). */
  fareIqd: Iqd.min(0),
  paymentMethod: GarageTaxiPayment.optional(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type BookToGarageInput = z.input<typeof BookToGarageInput>;

/**
 * x3: on the live ride screen of a taxi to a الرجعة car. `lateMin` > 0 once it would bring him after
 * the car's time; `driverTold` once the الرجعة driver has heard it (with `toldMin`).
 */
export const GarageTaxiLink = z.object({
  orderId: z.string(),
  bookingId: z.string(),
  garage: GarageTaxiGarage,
  departAt: z.coerce.date(),
  expectedAt: z.coerce.date().nullable(),
  lateMin: z.number().int().nonnegative(),
  driverTold: z.boolean(),
  toldMin: z.number().int().nonnegative().nullable(),
  /** x3 seat hold (RIDE_SEAT_HOLD): his seat waits for this taxi until then; null when not held. */
  seatHeldUntil: z.coerce.date().nullable().default(null),
});
export type GarageTaxiLink = z.infer<typeof GarageTaxiLink>;

export const GarageTaxiOrderInput = z.object({ orderId: z.string().min(1) });

/** x4: why no taxi can be armed for this seat. */
export const ArmUnavailable = z.enum(['not_to_aziziyah', 'not_booked', 'arrived', 'no_place']);
export type ArmUnavailable = z.infer<typeof ArmUnavailable>;

/**
 * x4 / n10 «نخلي تكسي ينتظرك؟»: `off` (can arm), `armed` (booked by the server near the garage),
 * `placed` (the ride is on: its order), `dropped` (the trip was cancelled), `failed` (the server could
 * not book it: he books it himself), `unavailable` (with why).
 */
export const GarageArmView = z.object({
  bookingId: z.string(),
  status: z.enum(['off', 'armed', 'placed', 'dropped', 'failed', 'unavailable']),
  unavailable: ArmUnavailable.nullable(),
  /** The Aziziyah garage the car is expected at (the nearest to it as it comes in). */
  garage: GarageTaxiGarage.nullable(),
  places: z.array(GarageTaxiPlace),
  toPlaceId: z.string().nullable(),
  toName: z.string().nullable(),
  /** Today's server fare garage → place, for the card only: the ride is priced when it is booked. */
  estimateIqd: Iqd.nullable(),
  paymentMethod: GarageTaxiPayment,
  /** The car's minutes to the garage now (null before it left). */
  carEtaMin: z.number().int().nonnegative().nullable(),
  placeAtEtaMin: z.number().int(),
  orderId: z.string().nullable(),
  placedAt: z.coerce.date().nullable(),
  /** `failed`: the refusal's code (`new_customer_cash_cap`, `price_changed`…). */
  failCode: z.string().nullable(),
});
export type GarageArmView = z.infer<typeof GarageArmView>;

export const ArmGarageTaxiInput = GarageTaxiInput.extend({ to: z.object({ placeId: z.string().min(1).max(64) }), paymentMethod: GarageTaxiPayment.optional() });
export type ArmGarageTaxiInput = z.input<typeof ArmGarageTaxiInput>;

/** `garageTaxi.*` — every call is the signed-in rider's own seat. */
export interface GarageTaxiPort {
  toGarage(actor: Actor, input: z.output<typeof ToGarageInput>): Promise<ToGaragePlan>;
  bookToGarage(actor: Actor, input: z.output<typeof BookToGarageInput>): Promise<ToGaragePlan>;
  forOrder(actor: Actor, input: z.output<typeof GarageTaxiOrderInput>): Promise<GarageTaxiLink | null>;
  arrival(actor: Actor, input: z.output<typeof GarageTaxiInput>): Promise<GarageArmView>;
  arm(actor: Actor, input: z.output<typeof ArmGarageTaxiInput>): Promise<GarageArmView>;
  disarm(actor: Actor, input: z.output<typeof GarageTaxiInput>): Promise<GarageArmView>;
}

/** Domain events (outbox): notify turns them into pushes; the routes thread may hold a seat on `late`. */
export const GARAGE_TAXI_EVENTS = {
  /** x3: `{bookingId, departureId, orderId, riderId, driverId, lateMin, expectedAt, departAt, garageId, seats}`. */
  late: 'garage_taxi.late',
  /** x4: `{bookingId, orderId, riderId, garageId}` — the server booked the waiting taxi. */
  placed: 'garage_taxi.placed',
  /** x4: `{bookingId, riderId, reason: 'trip_cancelled' | 'missed'}`. */
  dropped: 'garage_taxi.dropped',
  /** x4: `{bookingId, riderId, code}` — the server could not book it. */
  failed: 'garage_taxi.failed',
} as const;
