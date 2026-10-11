import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { Iqd } from './common.js';
import { MonthKey } from './household-budget.js';

// ───────────────────────── «دفترك ويا درايفر» (customer stats) ─────────────────────────

/** Which stretch of time the page shows: one Baghdad month, this Baghdad year so far, or since the first order. */
export const StatsPeriod = z.enum(['month', 'year', 'all']);
export type StatsPeriod = z.infer<typeof StatsPeriod>;

/** `month` names the month for `period: 'month'` (the current Baghdad month when absent). */
export const StatsInput = z.object({ period: StatsPeriod.default('year'), month: MonthKey.optional() });
export type StatsInput = z.input<typeof StatsInput>;

/** Times of day the "when you order" grid uses, Baghdad time. */
export const STATS_DAY_BANDS = ['morning', 'noon', 'afternoon', 'sunset', 'night'] as const;
export type StatsDayBand = (typeof STATS_DAY_BANDS)[number];

/** The band an hour (0–23, Baghdad) falls in: 05–11 morning, 11–14 noon, 14–17 afternoon, 17–19 sunset, else night. */
export function statsDayBand(hour: number): StatsDayBand {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'sunset';
  return 'night';
}

const count = z.number().int().nonnegative();

/** One month's column on the chart: what was delivered or travelled in it, per service. */
export const StatsMonth = z.object({ month: MonthKey, food: count, taxi: count, tuktuk: count, rajaa: count, savedIqd: Iqd.nonnegative() });
export type StatsMonth = z.infer<typeof StatsMonth>;

/**
 * «وفّرت» (option ① of the stats design, 2026-10-11; Ali went ahead with it): only what came off the customer's bills — kitchen
 * deals, our own promotions, points spent on fees and the الرجعة return-trip discount (the ledger's
 * `promo_funded` lines). Change kept in the wallet is the customer's own money and never counts.
 * What we paid back when we fell short (late-delivery credit, a driver's cancel after arriving) is
 * `madeGoodIqd`: shown beside the saving, never added to it.
 */
export const StatsSaved = z.object({
  totalIqd: Iqd.nonnegative(),
  dealsIqd: Iqd.nonnegative(),
  promosIqd: Iqd.nonnegative(),
  pointsIqd: Iqd.nonnegative(),
  returnTripIqd: Iqd.nonnegative(),
  madeGoodIqd: Iqd.nonnegative(),
});
export type StatsSaved = z.infer<typeof StatsSaved>;

const Named = z.object({ name: z.string(), orders: z.number().int().positive() });

/**
 * «دفترك ويا درايفر»: the caller's own record for one period, every figure counted by the server
 * from their orders, trips, الرجعة bookings and ledger lines; nothing estimated, nobody else's data.
 */
export const StatsView = z.object({
  period: StatsPeriod,
  /** The month shown when `period` is `month`. */
  month: MonthKey.nullable(),
  /** The earliest month a `month` period can step back to. */
  earliestMonth: MonthKey,
  /** When the person first ordered anything (null: never). */
  firstOrderAt: z.date().nullable(),
  saved: StatsSaved,
  /** One column per month of the period, oldest first (one for a month period). */
  months: z.array(StatsMonth),
  food: z.object({
    orders: count,
    kitchens: count,
    /** Restaurants on the app in the city, for «جربت 11 من 64». */
    kitchensInTown: count,
    topKitchens: z.array(Named).max(5),
    topDishes: z.array(Named.extend({ kitchen: z.string().nullable(), catalogItemId: z.string() })).max(3),
    /** Orders by weekday (0 = Saturday … 6 = Friday) × `STATS_DAY_BANDS`, Baghdad time. */
    when: z.array(z.array(count).length(5)).length(7),
    /** Delivered orders that carried a promised time, and how many arrived by it. */
    promise: z.object({ promised: count, onTime: count }),
    /** Placed → at the door, minutes; null when nothing was delivered. */
    doorMinutes: z.object({ average: count, fastest: count }).nullable(),
  }),
  rides: z.object({
    taxi: count,
    tuktuk: count,
    /** Accepted → driver at the pickup, minutes on average; null when not known. */
    pickupWaitMinutes: count.nullable(),
    /** The saved place the person rode to most (needs two visits). */
    topPlace: z.object({ name: z.string(), visits: z.number().int().positive() }).nullable(),
    /** Different drivers, a count only. */
    drivers: count,
  }),
  rajaa: z.object({ baghdad: count, kut: count, frontSeats: count, lapChildren: count, returnTrips: count }),
  money: z.object({ spentIqd: Iqd.nonnegative() }),
  points: z.object({ earned: count, used: count, balance: count }),
  hasActivity: z.boolean(),
});
export type StatsView = z.infer<typeof StatsView>;

export interface StatsPort {
  stats(actor: Actor, input: z.input<typeof StatsInput>): Promise<StatsView>;
}
