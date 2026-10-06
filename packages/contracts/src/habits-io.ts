import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd } from './common.js';
import { HhMm, LocalDate } from './store-hours.js';
import { OrderHistoryRow } from './tracking.js';

/**
 * Food habits (joy J7a): «قدر اليوم» (a kitchen's dish of the day), following a dish so its day comes
 * as one push, the person's usuals («طلبك المعتاد؟», «غدا الجمعة») and «مطاعمنا» (the kitchen's own
 * story, shown only with the owner's consent). Every figure here is the server's.
 */

// ───────────────────────── «قدر اليوم» ─────────────────────────

export const POT_RULES = {
  /** «ويا تمن عنبر» — one short line under the dish. */
  noteMaxChars: 60,
  /** Dishes posted in the last this many days come back as one-tap chips in the Merchant app. */
  recentDays: 14,
  /** A dish that was a pot in the last this many days can be followed from its item sheet. */
  followableDays: 30,
} as const;

export const FOLLOW_RULES = {
  /** Dishes one person may follow at once. */
  maxPerPerson: 30,
} as const;

/** The dish a pot names, as the customer menu shows it (menu price, today's photo). */
export const PotDish = z.object({
  id: z.string(),
  name: z.string(),
  priceIqd: Iqd,
  photoUrl: z.string().nullable(),
});
export type PotDish = z.infer<typeof PotDish>;

/** One kitchen's pot for today on the customer home («العزيزية اليوم»). */
export const TodayPot = z.object({
  merchantOrgId: z.string(),
  restaurantName: z.string(),
  restaurantOpen: z.boolean(),
  /** Next opening ("7:00", 12-hour) when closed. */
  opensAt: z.string().nullable(),
  dish: PotDish,
  note: z.string().nullable(),
  /** Shown until this local time today; null = until the end of the day. */
  until: HhMm.nullable(),
  /** The signed-in person follows this dish (always false for guests). */
  followed: z.boolean(),
});
export type TodayPot = z.infer<typeof TodayPot>;

export const PotsTodayInput = z.object({ cityId: CityId, dropoff: DeliveryPoint.optional() });
export type PotsTodayInput = z.input<typeof PotsTodayInput>;

/** The pot on a restaurant's own page (`catalog.menu`). */
export const MenuPot = z.object({ itemId: z.string(), note: z.string().nullable(), until: HhMm.nullable() });
export type MenuPot = z.infer<typeof MenuPot>;

export const FollowDishInput = z.object({ merchantOrgId: z.string().min(1), itemId: z.string().min(1), on: z.boolean() });
export type FollowDishInput = z.infer<typeof FollowDishInput>;

export const MyDishFollows = z.object({ itemIds: z.array(z.string()) });
export type MyDishFollows = z.infer<typeof MyDishFollows>;

/** The Merchant app's pot screen. */
export const MerchantPotView = z.object({
  merchantOrgId: z.string(),
  /** Baghdad date the view is for ("YYYY-MM-DD"). */
  date: LocalDate,
  today: z
    .object({ itemId: z.string(), name: z.string(), note: z.string().nullable(), until: HhMm.nullable(), postedAt: z.coerce.date() })
    .nullable(),
  /** The pot of the same weekday last week, when that dish is still on sale: «نفسها اليوم». */
  lastWeek: z.object({ itemId: z.string(), name: z.string() }).nullable(),
  /** Other dishes posted in the last `POT_RULES.recentDays` days, newest first, still on sale. */
  recent: z.array(z.object({ itemId: z.string(), name: z.string() })),
  /** How many people follow each of this kitchen's dishes (dish id → count); dishes with none are absent. */
  followers: z.record(z.string(), z.number().int().min(0)),
});
export type MerchantPotView = z.infer<typeof MerchantPotView>;

const PotNote = z
  .string()
  .trim()
  .max(POT_RULES.noteMaxChars)
  .transform((s) => (s.length > 0 ? s : null));

export const SetPotInput = z.object({
  merchantOrgId: z.string().min(1),
  itemId: z.string().min(1),
  note: PotNote.nullable().optional(),
  until: HhMm.nullable().optional(),
});
export type SetPotInput = z.input<typeof SetPotInput>;

// ───────────────────────── «مطاعمنا» ─────────────────────────

export const KITCHEN_STORY_RULES = {
  /** One to three short lines in the owner's own words. */
  textMaxChars: 180,
  maxLines: 3,
  /** Oldest year a kitchen can say it opened. */
  minYear: 1900,
} as const;

/** Lines of a story as the owner typed them (blank lines don't count). */
export function storyLines(text: string): number {
  return text.split('\n').filter((l) => l.trim().length > 0).length;
}

export const KitchenStoryText = z
  .string()
  .trim()
  .min(1)
  .max(KITCHEN_STORY_RULES.textMaxChars)
  .refine((s) => storyLines(s) <= KITCHEN_STORY_RULES.maxLines, { message: `at most ${KITCHEN_STORY_RULES.maxLines} lines` });

export const SinceYear = z.number().int().min(KITCHEN_STORY_RULES.minYear).max(2100);

export const KitchenStoryView = z.object({
  merchantOrgId: z.string(),
  text: z.string().nullable(),
  sinceYear: z.number().int().nullable(),
  /** The owner agreed to show it to customers. */
  shown: z.boolean(),
  /** Only the owner edits (consent is his). */
  canEdit: z.boolean(),
  updatedAt: z.coerce.date().nullable(),
});
export type KitchenStoryView = z.infer<typeof KitchenStoryView>;

export const SetKitchenStoryInput = z
  .object({
    merchantOrgId: z.string().min(1),
    /** Null clears the story. */
    text: KitchenStoryText.nullable(),
    sinceYear: SinceYear.nullable(),
    shown: z.boolean(),
  })
  .refine((s) => !(s.shown && s.text === null), { message: 'nothing to show', path: ['shown'] });
export type SetKitchenStoryInput = z.input<typeof SetKitchenStoryInput>;

/** What the restaurant page shows (only when the owner switched it on). */
export const MenuStory = z.object({ text: z.string(), sinceYear: z.number().int().nullable() });
export type MenuStory = z.infer<typeof MenuStory>;

// ───────────────────────── usuals ─────────────────────────

/**
 * «طلبك المعتاد؟» (joy s3, delight G3): the same order from the same kitchen (≥ `sameShare` of its
 * dishes), at least `minSameWeekday` times on one weekday and time band, or `minSameBand` times in one
 * band on any days, within `windowDays`. At most `max`, weekday ones first.
 */
export const USUAL_RULES = { windowDays: 42, sameShare: 0.7, minSameWeekday: 2, minSameBand: 3, max: 3 } as const;

/** Baghdad time bands a usual is learned in: 04–11, 11–16, 16–23, 23–04. */
export const UsualBand = z.enum(['morning', 'lunch', 'evening', 'late']);
export type UsualBand = z.infer<typeof UsualBand>;

/** The band an hour (0–23, Baghdad) falls in. */
export function usualBandOf(hour: number): UsualBand {
  if (hour >= 4 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 23) return 'evening';
  return 'late';
}

export const Usual = z.object({
  kind: z.enum(['weekday', 'band']),
  /** 0 = Sunday … 5 = Friday (weekday usuals); null for band usuals. */
  weekday: z.number().int().min(0).max(6).nullable(),
  band: UsualBand,
  /** How many matching orders in the window (the reason line says it). */
  times: z.number().int().min(2),
  /** Usual minute of the Baghdad day it was wanted at (0–1439), rounded to 30. */
  atMinute: z.number().int().min(0).max(1439),
  /** The newest matching order, as `orders.history` shows it (the reorder sheet rebuilds it). */
  row: OrderHistoryRow,
});
export type Usual = z.infer<typeof Usual>;
