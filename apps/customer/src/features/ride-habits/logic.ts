import {
  atLocal,
  baghdadDate,
  rideScheduleProblem,
  rideSearchStartsAt,
  RIDE_HABIT_RULES,
  shiftDate,
  type FavouriteDriverView,
  type FavouriteKind,
  type Order,
  type OccurrenceSummary,
  type RegularTripPlan,
} from '@driver/contracts';

/**
 * Joy J7d on the phone: the pure rules behind the ride-habit screens — when a ride can be booked
 * for, how a regular trip's days read, what an occurrence asks for — so the screens only display.
 */

const STEP = RIDE_HABIT_RULES.schedule.stepMin;
const QUARTERS = [0, 15, 30, 45] as const;

/** The days a ride can be booked on from the choose screen: today, tomorrow, the day after. */
export const SCHEDULE_DAYS = [0, 1, 2] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

export interface ScheduleChoice {
  day: ScheduleDay;
  hour: number;
  minute: number;
}

/** The instant of a schedule choice (Baghdad wall time). */
export function scheduleAt(now: Date, c: ScheduleChoice): Date {
  return atLocal(shiftDate(baghdadDate(now), c.day), c.hour * 60 + c.minute);
}

/** Whether the server will take this time (20 min to 7 days ahead). */
export function scheduleOk(now: Date, c: ScheduleChoice): boolean {
  return rideScheduleProblem(scheduleAt(now, c), now) === null;
}

/** The hours of a day with at least one quarter the server takes. */
export function hourOptions(now: Date, day: ScheduleDay): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h += 1) if (QUARTERS.some((m) => scheduleOk(now, { day, hour: h, minute: m }))) out.push(h);
  return out;
}

/** The quarters of that hour the server takes. */
export function minuteOptions(now: Date, day: ScheduleDay, hour: number): number[] {
  return QUARTERS.filter((m) => scheduleOk(now, { day, hour, minute: m }));
}

/** The first bookable quarter from now (20 minutes ahead, on the 15-minute grid). */
export function firstSlot(now: Date): ScheduleChoice {
  const earliest = now.getTime() + RIDE_HABIT_RULES.schedule.minLeadMin * 60_000;
  const at = new Date(Math.ceil(earliest / (STEP * 60_000)) * STEP * 60_000);
  const date = baghdadDate(at);
  const today = baghdadDate(now);
  const day = date === today ? 0 : date === shiftDate(today, 1) ? 1 : 2;
  const minuteOfDay = Math.round((at.getTime() - atLocal(date, 0).getTime()) / 60_000);
  return { day: day as ScheduleDay, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

/** A choice moved to a valid quarter of its day (the hour's first valid one, else the day's first). */
export function settleChoice(now: Date, c: ScheduleChoice): ScheduleChoice {
  if (scheduleOk(now, c)) return c;
  const mins = minuteOptions(now, c.day, c.hour);
  if (mins.length > 0) return { ...c, minute: mins[0]! };
  const hours = hourOptions(now, c.day);
  if (hours.length === 0) return firstSlot(now);
  const hour = hours.find((h) => h > c.hour) ?? hours[0]!;
  return { day: c.day, hour, minute: minuteOptions(now, c.day, hour)[0] ?? 0 };
}

/**
 * A ride booked for later whose search hasn't started yet: it waits on «مشوارك محجوز», not on the
 * live screen (and never as the home's "in progress" pill).
 */
export function isBookedRide(o: Pick<Order, 'type' | 'state' | 'scheduledFor'>, now: Date): boolean {
  return o.type === 'ride' && o.state === 'placed' && o.scheduledFor !== null && rideSearchStartsAt(o.scheduledFor).getTime() > now.getTime();
}

/** When dispatch starts looking for a driver for that booking. */
export function searchStartsAt(o: Pick<Order, 'scheduledFor'>): Date | null {
  return o.scheduledFor ? rideSearchStartsAt(o.scheduledFor) : null;
}

/** The favourites who drive this kind (a taxi ride asks only taxi drivers, الرجعة only الرجعة drivers). */
export function favouritesFor(favs: readonly FavouriteDriverView[], kind: FavouriteKind): FavouriteDriverView[] {
  return favs.filter((f) => f.kinds.includes(kind));
}

/** The favourite a regular trip's kind can ask for. */
export function planKind(plan: RegularTripPlan): FavouriteKind {
  return plan.kind === 'ride' ? plan.rideVertical : 'intercity';
}

/** The Iraqi week as the day chips show it: السبت first. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;
export const WORK_WEEK = [0, 1, 2, 3, 4] as const;

export type DaysLabel = { kind: 'every' } | { kind: 'work' } | { kind: 'one'; dow: number } | { kind: 'list'; dows: number[] };

/** How a trip's days read: «كل يوم», «الأحد–الخميس», «كل خميس», or the days in week order. */
export function daysLabel(days: readonly number[]): DaysLabel {
  const set = [...new Set(days)];
  if (set.length === 7) return { kind: 'every' };
  if (set.length === WORK_WEEK.length && WORK_WEEK.every((d) => set.includes(d))) return { kind: 'work' };
  if (set.length === 1) return { kind: 'one', dow: set[0]! };
  return { kind: 'list', dows: WEEK_ORDER.filter((d) => set.includes(d)) };
}

/** Toggles a day in a selection (never leaving it empty). */
export function toggleDay(days: readonly number[], dow: number): number[] {
  const next = days.includes(dow) ? days.filter((d) => d !== dow) : [...days, dow];
  return next.length === 0 ? [...days] : next.sort((a, b) => a - b);
}

/** A trip time (minutes since midnight) as an instant today, for the city clock. */
export function timeAt(timeMin: number, now: Date): Date {
  return atLocal(baghdadDate(now), timeMin);
}

/** The morning reminder needs a trip from 09:00 (it goes at 08:00, when quiet hours end). */
export function morningAllowed(timeMin: number): boolean {
  return timeMin >= RIDE_HABIT_RULES.regular.morningFromMin;
}

/** The reminder a time suggests: the evening before for early trips, else that morning. */
export function defaultRemind(timeMin: number): 'evening' | 'morning' {
  return timeMin < 11 * 60 ? 'evening' : 'morning';
}

/** What the occurrence screen leads with. */
export type OccurrenceAction = 'confirm' | 'booked' | 'skipped' | 'closed';

export function occurrenceAction(o: Pick<OccurrenceSummary, 'state'>): OccurrenceAction {
  if (o.state === 'confirmed') return 'booked';
  if (o.state === 'skipped') return 'skipped';
  if (o.state === 'closed') return 'closed';
  return 'confirm';
}

/** «تأكدها» cards: the trips with an occurrence asking now, soonest first. */
export function askingNow<T extends { next: Pick<OccurrenceSummary, 'state' | 'at'> | null; plan: RegularTripPlan }>(trips: readonly T[], kind?: RegularTripPlan['kind']): T[] {
  return trips.filter((t) => t.next?.state === 'asking' && (!kind || t.plan.kind === kind)).sort((a, b) => a.next!.at.getTime() - b.next!.at.getTime());
}

/** The far city of a الرجعة corridor (`aziziyah_kut` → `kut`). */
export function corridorCity(corridorId: string): string {
  return corridorId.replace(/^aziziyah_/, '');
}

/**
 * Checkout's slots with «وياك» (joy r6): the server's delivery time for dinner joins the day's
 * pre-order slots (replacing one at the same instant), in time order.
 */
export function withDinnerSlot<S extends { at: Date }>(slots: readonly S[], dinnerAt: Date | null, make: (at: Date) => S): Array<S & { dinner: boolean }> {
  const plain = slots.map((s) => ({ ...s, dinner: false }));
  if (!dinnerAt) return plain;
  const rest = plain.filter((s) => s.at.getTime() !== dinnerAt.getTime());
  return [...rest, { ...make(dinnerAt), dinner: true }].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** «عشاك يوصل وياك» line: with him, or N minutes after him. */
export function dinnerLine(lateByMin: number): { key: 'with' } | { key: 'after'; minutes: number } {
  return lateByMin > 0 ? { key: 'after', minutes: lateByMin } : { key: 'with' };
}
