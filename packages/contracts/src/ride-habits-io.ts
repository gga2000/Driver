import { z } from 'zod';
import { DeliveryPoint, Iqd, LatLng } from './common.js';
import type { BookedRideInput, BookedRideStatus } from './booked-rides.js';
import type { DriverProfile, DriverProfileInput, MyRideOffers, MyRideOffersInput, NudgeOfferInput, NudgeOfferResult } from './dispatch-io.js';
import type { Actor } from './identity-io.js';
import { DepartureCard, IntercityDirection, TravellingAs } from './routes-io.js';
import { haversineM } from './tracking.js';

/**
 * J7d ride habits (joy r5, r6, l9): regular trips that ask before they book, dinner timed to the ride
 * home, and favourite drivers for scheduled rides and الرجعة. Every figure the apps show (fares, seat
 * prices, times) is the server's; the pure rules below are shared so the apps can explain them.
 */
export const RIDE_HABIT_RULES = {
  /**
   * A ride booked for later: at least this far ahead, at most this many days, on a 5-minute grid (the
   * app offers the quarters). With no driver confirmed the evening before (review #28, `booked-rides.ts`)
   * the search starts `searchLeadMin` early — T−30 — which is also when a confirmed driver must be on his
   * way, or the job is released. Step 4 (c10): the rider is reminded `reminderLeadMin` before the ride
   * time — only when that is at least `reminderMinGapMin` after he booked; a ride booked closer needs no
   * reminder.
   */
  schedule: { minLeadMin: 20, maxAheadDays: 7, gridMin: 5, searchLeadMin: 30, stepMin: 15, reminderLeadMin: 30, reminderMinGapMin: 30 },
  /**
   * Step 4 (o4) «نفس مشوار البارحة؟»: the same pickup and drop-off (each within `radiusM`) at about the
   * same time (±`windowMin`) on `needed` of the last `lookbackDays` working days (Sunday–Thursday, the
   * latest of them included). One gentle push `pushBeforeMin` before that time, at most one a day; the
   * job still sends it up to `lastCallMin` before the time, never later.
   */
  sameRide: { radiusM: 200, windowMin: 20, lookbackDays: 4, needed: 3, roundMin: 5, pushBeforeMin: 10, lastCallMin: 3, workDays: [0, 1, 2, 3, 4] },
  /**
   * l9: the favourite rings alone this long before the normal waves; at most this many per person.
   * s4: without a favourite asked for, a favourite online and free within `autoFirstKm` of the pickup
   * gets any ride of his first, alone, for the same window.
   */
  favourite: { offerWindowSec: 60, maxPerPerson: 20, goodStars: 4, recentHours: 24, autoFirstKm: 2 },
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
export function rideScheduleProblem(scheduledFor: Date, now: Date): 'too_soon' | 'too_far' | 'off_grid' | null {
  const ahead = scheduledFor.getTime() - now.getTime();
  if (ahead < RIDE_HABIT_RULES.schedule.minLeadMin * 60_000) return 'too_soon';
  if (ahead > RIDE_HABIT_RULES.schedule.maxAheadDays * DAY_MS) return 'too_far';
  if (scheduledFor.getTime() % (RIDE_HABIT_RULES.schedule.gridMin * 60_000) !== 0) return 'off_grid';
  return null;
}

/** When dispatch starts looking for a driver for a ride booked for `scheduledFor`. */
export function rideSearchStartsAt(scheduledFor: Date): Date {
  return new Date(scheduledFor.getTime() - RIDE_HABIT_RULES.schedule.searchLeadMin * 60_000);
}

/**
 * Step 4 (c10): when the rider of a ride booked at `placedAt` for `scheduledFor` gets «مشوارك بعد نص
 * ساعة» — half an hour before, a quarter before the search starts; null when he booked so close that
 * the reminder would come within half an hour of booking.
 */
export function rideReminderAt(scheduledFor: Date, placedAt: Date): Date | null {
  const s = RIDE_HABIT_RULES.schedule;
  const at = new Date(scheduledFor.getTime() - s.reminderLeadMin * 60_000);
  return at.getTime() - placedAt.getTime() >= s.reminderMinGapMin * 60_000 ? at : null;
}

// ───────────────────────── «نفس مشوار البارحة؟» (step 4, o4) ─────────────────────────

/** One ride the rider took: where from and to, how, and the time he wanted it (booked time, else placed). */
export interface RideFootprint {
  orderId: string;
  vertical: 'taxi' | 'tuktuk';
  doorPickup: boolean;
  pickup: { zoneKey: string; pin: LatLng; placeId?: string | undefined };
  dropoff: { zoneKey: string; pin: LatLng; placeId?: string | undefined };
  at: Date;
}

/** A ride he takes most working days at about the same time: what to offer and when. */
export interface SameRideHabit {
  vertical: 'taxi' | 'tuktuk';
  doorPickup: boolean;
  pickup: RideFootprint['pickup'];
  dropoff: RideFootprint['dropoff'];
  /** Minutes since Baghdad midnight: the middle of his times, rounded to 5 minutes. */
  timeMin: number;
  /** The working days he made it (newest first); the first is the last working day before today. */
  dates: CalendarDate[];
}

/** The working days (Sunday–Thursday) before `today`, newest first. */
export function workDaysBefore(today: CalendarDate, n: number): CalendarDate[] {
  const out: CalendarDate[] = [];
  const work = RIDE_HABIT_RULES.sameRide.workDays as readonly number[];
  for (let d = shiftDate(today, -1); out.length < n; d = shiftDate(d, -1)) if (work.includes(baghdadWeekday(atLocal(d, 12 * 60)))) out.push(d);
  return out;
}

/** Whether `date` is a working day (the habit is about school and work). */
export function isWorkDay(date: CalendarDate): boolean {
  return (RIDE_HABIT_RULES.sameRide.workDays as readonly number[]).includes(baghdadWeekday(atLocal(date, 12 * 60)));
}

/** Whether two rides are «the same ride»: both ends within 200 m, and the time within ±20 minutes. */
export function sameRide(a: Pick<RideFootprint, 'pickup' | 'dropoff' | 'at'>, b: Pick<RideFootprint, 'pickup' | 'dropoff' | 'at'>): boolean {
  const r = RIDE_HABIT_RULES.sameRide;
  return haversineM(a.pickup.pin, b.pickup.pin) <= r.radiusM && haversineM(a.dropoff.pin, b.dropoff.pin) <= r.radiusM && Math.abs(baghdadMinuteOfDay(a.at) - baghdadMinuteOfDay(b.at)) <= r.windowMin;
}

/**
 * The habits a rider has on `today` from his finished rides: a ride from the last working day that he
 * also made on at least two of the three working days before it (3 of the last 4, the latest included),
 * on a working day only. Each ride counts toward one habit; the newest ride of the habit says vehicle,
 * door pickup and the exact points. Soonest first.
 */
export function sameRideHabits(rides: readonly RideFootprint[], today: CalendarDate): SameRideHabit[] {
  const r = RIDE_HABIT_RULES.sameRide;
  if (!isWorkDay(today)) return [];
  const days = workDaysBefore(today, r.lookbackDays);
  const inWindow = rides.filter((x) => days.includes(baghdadDate(x.at))).sort((a, b) => b.at.getTime() - a.at.getTime());
  const used = new Set<string>();
  const out: SameRideHabit[] = [];
  for (const anchor of inWindow) {
    if (used.has(anchor.orderId) || baghdadDate(anchor.at) !== days[0]) continue;
    // One ride per day: the closest in time to the anchor's.
    const perDay = new Map<CalendarDate, RideFootprint>();
    for (const x of inWindow) {
      if (used.has(x.orderId) || !sameRide(anchor, x)) continue;
      const d = baghdadDate(x.at);
      const had = perDay.get(d);
      const gap = (y: RideFootprint) => Math.abs(baghdadMinuteOfDay(y.at) - baghdadMinuteOfDay(anchor.at));
      if (!had || gap(x) < gap(had)) perDay.set(d, x);
    }
    if (perDay.size < r.needed) continue;
    const picked = [...perDay.values()];
    for (const x of picked) used.add(x.orderId);
    const minutes = picked.map((x) => baghdadMinuteOfDay(x.at)).sort((a, b) => a - b);
    const mid = minutes.length % 2 === 1 ? minutes[(minutes.length - 1) / 2]! : (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2;
    out.push({
      vertical: anchor.vertical,
      doorPickup: anchor.doorPickup,
      pickup: anchor.pickup,
      dropoff: anchor.dropoff,
      timeMin: Math.round(mid / r.roundMin) * r.roundMin,
      dates: days.filter((d) => perDay.has(d)),
    });
  }
  return out.sort((a, b) => a.timeMin - b.timeMin);
}

/** When the push for a habit goes on `today` (10 minutes before), and the last moment it still may. */
export function sameRidePushWindow(h: Pick<SameRideHabit, 'timeMin'>, today: CalendarDate): { from: Date; until: Date; at: Date } {
  const r = RIDE_HABIT_RULES.sameRide;
  const at = atLocal(today, h.timeMin);
  return { from: new Date(at.getTime() - r.pushBeforeMin * 60_000), until: new Date(at.getTime() - r.lastCallMin * 60_000), at };
}

/** `lat,lng,zone[,placeId]`: one end of the ride in the push's deep link. */
export function encodeRideEnd(p: RideFootprint['pickup']): string {
  return [p.pin.lat.toFixed(6), p.pin.lng.toFixed(6), p.zoneKey, ...(p.placeId ? [p.placeId] : [])].join(',');
}

/** The end back from the deep link; null when it is not one of ours. */
export function decodeRideEnd(raw: unknown): RideFootprint['pickup'] | null {
  if (typeof raw !== 'string') return null;
  const [lat, lng, zoneKey, placeId] = raw.split(',');
  const pin = LatLng.safeParse({ lat: Number(lat), lng: Number(lng) });
  if (!pin.success || !zoneKey || !/^[a-z0-9_]{1,64}$/.test(zoneKey)) return null;
  return { zoneKey, pin: pin.data, ...(placeId && /^[A-Za-z0-9_-]{1,64}$/.test(placeId) ? { placeId } : {}) };
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

// ───────────────────────── «ما أريده مرة ثانية» (s5) ─────────────────────────

/**
 * Keep the driver of one of my rides (finished, or the one assigned now) off my rides for good.
 * Dispatch never offers my rides to him again; if he was a favourite, he no longer is.
 */
export const AvoidDriverInput = z.object({ orderId: z.string().min(1) });
export type AvoidDriverInput = z.infer<typeof AvoidDriverInput>;

/** A driver I keep off my rides: first name and approved photo only (logged vault reads). */
export const AvoidedDriverView = z.object({
  /** The avoid row's id (what `unavoid` takes); not the driver's. */
  id: z.string(),
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  since: z.coerce.date(),
});
export type AvoidedDriverView = z.infer<typeof AvoidedDriverView>;

export const UnavoidInput = z.object({ avoidId: z.string().min(1) });
export type UnavoidInput = z.infer<typeof UnavoidInput>;

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
  /** s5: keep the driver of one of my rides off my rides; returns my whole list. */
  avoid(actor: Actor, input: AvoidDriverInput): Promise<AvoidedDriverView[]>;
  avoided(actor: Actor): Promise<AvoidedDriverView[]>;
  unavoid(actor: Actor, input: UnavoidInput): Promise<AvoidedDriverView[]>;
  /** n3: the drivers who were sent my searching ride (`dispatch.myRideOffers`). */
  myRideOffers(actor: Actor, input: MyRideOffersInput): Promise<MyRideOffers>;
  /** n4 «نبّهه» (`dispatch.nudgeOffer`). */
  nudgeOffer(actor: Actor, input: NudgeOfferInput): Promise<NudgeOfferResult>;
  /** n5: an offered or the assigned driver's profile (`tracking.driverProfile`). */
  driverProfile(actor: Actor, input: DriverProfileInput): Promise<DriverProfile>;
  /** Review #28: a ride booked for later — confirmed driver, or when we tell him. */
  bookedRide(actor: Actor, input: BookedRideInput): Promise<BookedRideStatus>;
}
