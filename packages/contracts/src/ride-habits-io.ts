import { z } from 'zod';
import { DeliveryPoint, Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { DepartureCard, IntercityDirection, TravellingAs } from './routes-io.js';

/**
 * J7d ride habits (joy r5, r6, l9): regular trips that ask before they book, dinner timed to the ride
 * home, and favourite drivers for scheduled rides and الرجعة. Every figure the apps show (fares, seat
 * prices, times) is the server's; the pure rules below are shared so the apps can explain them.
 */
export const RIDE_HABIT_RULES = {
  /** A ride booked for later: at least this far ahead, at most this many days, the search starts this early. */
  schedule: { minLeadMin: 20, maxAheadDays: 7, searchLeadMin: 15, stepMin: 15 },
  /** l9: the favourite rings alone this long before the normal waves; at most this many per person. */
  favourite: { offerWindowSec: 60, maxPerPerson: 20, goodStars: 4, recentHours: 24 },
  /**
   * r5: the evening ask at 20:00 the day before, the morning ask at 08:00 (the end of quiet hours) for
   * trips from 09:00; an occurrence closer than `closeLeadMin` can no longer be confirmed. الرجعة looks
   * for cars from `rajaaBeforeMin` before to `rajaaAfterMin` after the usual time.
   */
  regular: { maxPerPerson: 10, eveningHour: 20, morningHour: 8, morningFromMin: 9 * 60, closeLeadMin: 20, rajaaBeforeMin: 60, rajaaAfterMin: 120, horizonDays: 8 },
  /** r6: offered for arrivals within this many minutes; times rounded up to 5; the courier needs ≥ 10. */
  dinner: { maxAheadMin: 150, roundMin: 5, courierMin: 10 },
} as const;

// ───────────────────────── Baghdad calendar ─────────────────────────

/** Baghdad is UTC+3 all year (no DST). */
const OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** A Baghdad calendar date, `YYYY-MM-DD`. */
export const CalendarDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
export type CalendarDate = z.infer<typeof CalendarDate>;

/** The Baghdad date of an instant. */
export function baghdadDate(at: Date): CalendarDate {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, in Baghdad. */
export function baghdadWeekday(at: Date): number {
  return new Date(at.getTime() + OFFSET_MS).getUTCDay();
}

/** Minutes since Baghdad midnight. */
export function baghdadMinuteOfDay(at: Date): number {
  const d = new Date(at.getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The instant of `minute` (since midnight) on a Baghdad date. */
export function atLocal(date: CalendarDate, minute: number): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS + minute * 60_000);
}

/** The Baghdad date `n` days away. */
export function shiftDate(date: CalendarDate, n: number): CalendarDate {
  return baghdadDate(new Date(atLocal(date, 12 * 60).getTime() + n * DAY_MS));
}

// ───────────────────────── scheduled rides ─────────────────────────

/** Why a ride can't be booked for that time; null when it can (`ride_schedule_invalid`). */
export function rideScheduleProblem(scheduledFor: Date, now: Date): 'too_soon' | 'too_far' | null {
  const ahead = scheduledFor.getTime() - now.getTime();
  if (ahead < RIDE_HABIT_RULES.schedule.minLeadMin * 60_000) return 'too_soon';
  if (ahead > RIDE_HABIT_RULES.schedule.maxAheadDays * DAY_MS) return 'too_far';
  return null;
}

/** When dispatch starts looking for a driver for a ride booked for `scheduledFor`. */
export function rideSearchStartsAt(scheduledFor: Date): Date {
  return new Date(scheduledFor.getTime() - RIDE_HABIT_RULES.schedule.searchLeadMin * 60_000);
}

// ───────────────────────── favourites (l9) ─────────────────────────

export const FavouriteKind = z.enum(['taxi', 'tuktuk', 'intercity']);
export type FavouriteKind = z.infer<typeof FavouriteKind>;

/** A favourite as his rider sees it: first name and approved photo only, never a phone. */
export const FavouriteDriverView = z.object({
  /** The favourite's own id (what a booking asks for); not the driver's. */
  id: z.string(),
  /** The driver's id, as the الرجعة board already shows it (to mark his departures). */
  driverId: z.string(),
  /** First name (logged vault read); null when he set none. */
  firstName: z.string().nullable(),
  /** His approved main photo, signed and short-lived; null → the app draws his initial. */
  photoUrl: z.string().nullable(),
  kinds: z.array(FavouriteKind),
  /** What customers gave him (joy l2's public rating: newest 50, shown from 5); null below that. */
  rating: z.number().nullable(),
  ratingCount: z.number().int().min(0),
  /** Finished rides and الرجعة trips this rider took with him. */
  tripsTogether: z.number().int().min(0),
  since: z.coerce.date(),
});
export type FavouriteDriverView = z.infer<typeof FavouriteDriverView>;

/** Heart (or un-heart) the driver of my own finished ride or الرجعة trip rated 4–5. */
export const FavouriteInput = z
  .object({ orderId: z.string().min(1).optional(), bookingId: z.string().min(1).optional(), on: z.boolean() })
  .refine((v) => Boolean(v.orderId) !== Boolean(v.bookingId), { message: 'orderId or bookingId' });
export type FavouriteInput = z.input<typeof FavouriteInput>;

export const UnfavouriteInput = z.object({ favouriteId: z.string().min(1) });
export type UnfavouriteInput = z.infer<typeof UnfavouriteInput>;

/** The driver of my last good trip (last 24 h, 4–5 stars) who is not a favourite yet. */
export const RecentDriverView = z.object({
  orderId: z.string().nullable(),
  bookingId: z.string().nullable(),
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  kind: FavouriteKind,
  stars: z.number().int().min(1).max(5),
  finishedAt: z.coerce.date(),
});
export type RecentDriverView = z.infer<typeof RecentDriverView>;

// ───────────────────────── regular trips (r5) ─────────────────────────

export const RegularRemind = z.enum(['evening', 'morning']);
export type RegularRemind = z.infer<typeof RegularRemind>;

/** A ride's end: the place (zone, pin, saved-place link) and the words the rider knows it by. */
export const RegularPoint = DeliveryPoint.omit({ door: true }).extend({ pin: DeliveryPoint.shape.pin.unwrap(), label: z.string().trim().min(1).max(60) });
export type RegularPoint = z.infer<typeof RegularPoint>;

export const RegularRide = z.object({
  kind: z.literal('ride'),
  rideVertical: z.enum(['taxi', 'tuktuk']),
  pickup: RegularPoint,
  dropoff: RegularPoint,
  doorPickup: z.boolean().default(false),
});
export type RegularRide = z.infer<typeof RegularRide>;

export const RegularRajaa = z.object({
  kind: z.literal('rajaa'),
  corridorId: z.string().min(1),
  direction: IntercityDirection,
  /** The garage he leaves from (the board and the demand post are by corridor and direction). */
  garageId: z.string().min(1),
  travellingAs: TravellingAs,
});
export type RegularRajaa = z.infer<typeof RegularRajaa>;

export const RegularTripPlan = z.discriminatedUnion('kind', [RegularRide, RegularRajaa]);
export type RegularTripPlan = z.infer<typeof RegularTripPlan>;

/** Days of the week, Baghdad: 0 = Sunday … 6 = Saturday. */
export const WeekDays = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .transform((d) => [...new Set(d)].sort((a, b) => a - b));

export const SaveRegularTripInput = z
  .object({
    /** Edit this one; absent = a new regular trip. */
    id: z.string().min(1).optional(),
    days: WeekDays,
    /** Minutes since Baghdad midnight, on a 5-minute step. */
    timeMin: z.number().int().min(0).max(1435).refine((m) => m % 5 === 0, { message: '5-minute step' }),
    remind: RegularRemind,
    paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
    /** One of the rider's favourites to ask for; null = anyone. */
    favouriteId: z.string().min(1).nullable().default(null),
    active: z.boolean().default(true),
    plan: RegularTripPlan,
  })
  .refine((v) => v.remind === 'evening' || v.timeMin >= RIDE_HABIT_RULES.regular.morningFromMin, { message: 'morning reminder needs a trip from 09:00', path: ['remind'] });
export type SaveRegularTripInput = z.input<typeof SaveRegularTripInput>;

/** Where an occurrence stands: not asked yet, asking, booked, skipped, or too close to confirm. */
export const OccurrenceState = z.enum(['waiting', 'asking', 'confirmed', 'skipped', 'closed']);
export type OccurrenceState = z.infer<typeof OccurrenceState>;

export const OccurrenceSummary = z.object({
  date: CalendarDate,
  at: z.coerce.date(),
  askAt: z.coerce.date(),
  state: OccurrenceState,
  orderId: z.string().nullable(),
  bookingId: z.string().nullable(),
  demandId: z.string().nullable(),
});
export type OccurrenceSummary = z.infer<typeof OccurrenceSummary>;

export const RegularTripView = z.object({
  id: z.string(),
  days: z.array(z.number().int().min(0).max(6)),
  timeMin: z.number().int(),
  remind: RegularRemind,
  paymentMethod: z.enum(['cash', 'wallet']),
  favourite: FavouriteDriverView.nullable(),
  active: z.boolean(),
  plan: RegularTripPlan,
  /** The next one to ask about or already decided; null when paused. */
  next: OccurrenceSummary.nullable(),
  /** Days already booked from it and still ahead (a ride for later, a seat, «أريد أرجع»). */
  booked: z.array(OccurrenceSummary).default([]),
});
export type RegularTripView = z.infer<typeof RegularTripView>;

export const RegularTripIdInput = z.object({ id: z.string().min(1) });
export type RegularTripIdInput = z.infer<typeof RegularTripIdInput>;

export const OccurrenceInput = z.object({ id: z.string().min(1), date: CalendarDate });
export type OccurrenceInput = z.infer<typeof OccurrenceInput>;

/** One occurrence with what «أكدها» would book: the server's fare at that time, or that day's cars. */
export const OccurrenceView = z.object({
  trip: RegularTripView,
  occurrence: OccurrenceSummary,
  /** Rides: the fare the server quotes for that time (what the booking must match). */
  ride: z.object({ fareIqd: Iqd, quoteId: z.string() }).nullable(),
  /** الرجعة: that day's cars around the usual time, the favourite's first. */
  rajaa: z.object({ departures: z.array(DepartureCard) }).nullable(),
});
export type OccurrenceView = z.infer<typeof OccurrenceView>;

export const ConfirmOccurrenceInput = z.object({
  id: z.string().min(1),
  date: CalendarDate,
  /** Rides: the fare shown; a different server fare is `price_changed`. */
  fareIqd: Iqd.optional(),
  /** الرجعة: the car chosen; absent with `waitForCar` posts «أريد أرجع» for the window. */
  departureId: z.string().min(1).optional(),
  waitForCar: z.boolean().optional(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type ConfirmOccurrenceInput = z.input<typeof ConfirmOccurrenceInput>;

interface RegularSchedule {
  days: readonly number[];
  timeMin: number;
  remind: RegularRemind;
}

/** When the reminder for the occurrence on `date` goes: 20:00 the day before, or 08:00 that day. */
export function askAt(date: CalendarDate, remind: RegularRemind): Date {
  const r = RIDE_HABIT_RULES.regular;
  return remind === 'evening' ? atLocal(shiftDate(date, -1), r.eveningHour * 60) : atLocal(date, r.morningHour * 60);
}

/** The trip's occurrences from today for `horizonDays` days, in time order (past ones included). */
export function occurrencesFrom(s: RegularSchedule, now: Date, horizonDays: number = RIDE_HABIT_RULES.regular.horizonDays): Array<{ date: CalendarDate; at: Date; askAt: Date }> {
  const today = baghdadDate(now);
  const out: Array<{ date: CalendarDate; at: Date; askAt: Date }> = [];
  for (let i = 0; i < horizonDays; i += 1) {
    const date = shiftDate(today, i);
    const at = atLocal(date, s.timeMin);
    if (s.days.includes(baghdadWeekday(at))) out.push({ date, at, askAt: askAt(date, s.remind) });
  }
  return out;
}

/** Whether `date` is one of the trip's days (an occurrence anyone may open). */
export function isOccurrenceDate(s: RegularSchedule, date: CalendarDate): boolean {
  return s.days.includes(baghdadWeekday(atLocal(date, s.timeMin)));
}

export interface OccurrenceDecision {
  state: 'confirmed' | 'skipped';
  orderId: string | null;
  bookingId: string | null;
  demandId: string | null;
}

/** An occurrence's state at `now` from its decision (if any). */
export function occurrenceState(o: { at: Date; askAt: Date }, decision: OccurrenceDecision | undefined, now: Date): OccurrenceState {
  if (decision) return decision.state;
  if (o.at.getTime() - now.getTime() < RIDE_HABIT_RULES.regular.closeLeadMin * 60_000) return 'closed';
  return now.getTime() >= o.askAt.getTime() ? 'asking' : 'waiting';
}

/**
 * The occurrence the rider should see next: the first still ahead that is either decided (booked or
 * skipped, until it passes) or still open to confirm. Closed ones he never answered are passed over.
 */
export function nextOccurrence(s: RegularSchedule, now: Date, decisions: ReadonlyMap<CalendarDate, OccurrenceDecision>): OccurrenceSummary | null {
  for (const o of occurrencesFrom(s, now)) {
    if (o.at.getTime() <= now.getTime()) continue;
    const d = decisions.get(o.date);
    const state = occurrenceState(o, d, now);
    if (state === 'closed') continue;
    return { ...o, state, orderId: d?.orderId ?? null, bookingId: d?.bookingId ?? null, demandId: d?.demandId ?? null };
  }
  return null;
}

/** Occurrences whose reminder is due now: asked for, undecided, still open to confirm. */
export function dueReminders(s: RegularSchedule, now: Date, decided: ReadonlySet<CalendarDate>): Array<{ date: CalendarDate; at: Date }> {
  return occurrencesFrom(s, now, 2)
    .filter((o) => !decided.has(o.date) && occurrenceState(o, undefined, now) === 'asking')
    .map((o) => ({ date: o.date, at: o.at }));
}

// ───────────────────────── «عشاك يوصل وياك» (r6) ─────────────────────────

export const DinnerSource = z.discriminatedUnion('kind', [z.object({ kind: z.literal('ride'), orderId: z.string().min(1) }), z.object({ kind: z.literal('rajaa'), bookingId: z.string().min(1) })]);
export type DinnerSource = z.infer<typeof DinnerSource>;

export const DinnerPlace = z.object({ placeId: z.string(), name: z.string(), label: z.string() });
export type DinnerPlace = z.infer<typeof DinnerPlace>;

/** A ride home (or a الرجعة to Aziziyah) on now, and when he gets there. */
export const DinnerChance = z.object({
  source: DinnerSource,
  vehicle: FavouriteKind,
  arriveAt: z.coerce.date(),
  place: DinnerPlace,
});
export type DinnerChance = z.infer<typeof DinnerChance>;

export const DinnerTimeInput = z.object({ source: DinnerSource, merchantOrgId: z.string().min(1) });
export type DinnerTimeInput = z.infer<typeof DinnerTimeInput>;

/** The server's pick for this kitchen: when the food reaches the door (the order's `scheduledFor`). */
export const DinnerTime = z.object({
  arriveAt: z.coerce.date(),
  deliverAt: z.coerce.date(),
  /** When the kitchen should have it ready. */
  kitchenReadyAt: z.coerce.date(),
  /** > 0 when the kitchen can't make it by his arrival: the food comes this many minutes after him. */
  lateByMin: z.number().int().min(0),
  place: DinnerPlace,
});
export type DinnerTime = z.infer<typeof DinnerTime>;

/** Up to the next `roundMin` minutes. */
export function roundUpTo(at: Date, minutes: number): Date {
  const step = minutes * 60_000;
  return new Date(Math.ceil(at.getTime() / step) * step);
}

/**
 * The delivery time for dinner: his arrival, unless the kitchen can't make it (then the earliest it
 * can), rounded up to 5 minutes; how late after him that is.
 */
export function dinnerDeliverAt(arriveAt: Date, earliestAt: Date): { deliverAt: Date; lateByMin: number } {
  const deliverAt = roundUpTo(new Date(Math.max(arriveAt.getTime(), earliestAt.getTime())), RIDE_HABIT_RULES.dinner.roundMin);
  const lateByMin = earliestAt.getTime() > arriveAt.getTime() ? Math.ceil((deliverAt.getTime() - arriveAt.getTime()) / 60_000) : 0;
  return { deliverAt, lateByMin };
}

// ───────────────────────── port ─────────────────────────

export interface RideHabitsPort {
  favourites(actor: Actor): Promise<FavouriteDriverView[]>;
  favourite(actor: Actor, input: z.infer<typeof FavouriteInput>): Promise<FavouriteDriverView[]>;
  unfavourite(actor: Actor, input: UnfavouriteInput): Promise<FavouriteDriverView[]>;
  recentGood(actor: Actor): Promise<RecentDriverView | null>;
  regularList(actor: Actor): Promise<RegularTripView[]>;
  regularSave(actor: Actor, input: z.output<typeof SaveRegularTripInput>): Promise<RegularTripView>;
  regularRemove(actor: Actor, input: RegularTripIdInput): Promise<{ ok: true }>;
  occurrence(actor: Actor, input: OccurrenceInput): Promise<OccurrenceView>;
  confirm(actor: Actor, input: z.output<typeof ConfirmOccurrenceInput>): Promise<OccurrenceView>;
  skip(actor: Actor, input: OccurrenceInput): Promise<OccurrenceView>;
  dinnerChance(actor: Actor): Promise<DinnerChance | null>;
  dinnerTime(actor: Actor, input: DinnerTimeInput): Promise<DinnerTime>;
}
