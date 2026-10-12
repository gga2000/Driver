import { z } from 'zod';
import { Iqd } from './common.js';

/**
 * What an order line can carry for the shopping side (2026-10-11), kept apart from `shopping-io` so
 * `order.ts` can use it without an import cycle: the weight of a kilo-sold line, and a دوّرلي item's
 * details. Neither holds personal data (lane A condition d).
 */

/** The scale: quarter-kilo steps up to 3 kilos (round 2 «الميزان»). */
export const WEIGHT_RULES = { stepG: 250, maxG: 3000 } as const;

/** Grams on the scale: a positive multiple of the step, up to the maximum. */
export const WeightG = z
  .number()
  .int()
  .min(WEIGHT_RULES.stepG)
  .max(WEIGHT_RULES.maxG)
  .refine((g) => g % WEIGHT_RULES.stepG === 0, { message: 'weight in quarter kilos' });

/**
 * The price of `grams` at `perKgIqd`: the kilo price × grams ÷ 1000, up to the whole dinar (750 a kilo
 * for a quarter is 188). No rounding to 250 on the line: a cash order's total rounds up as every cash
 * order does, the change going to the wallet (decision card to Ali 2026-10-11, recommended).
 */
export function priceForWeight(perKgIqd: number, grams: number): number {
  return Math.ceil((perKgIqd * grams) / 1000);
}

export const ErrandUnit = z.enum(['piece', 'box', 'kg', 'carton']);
export type ErrandUnit = z.infer<typeof ErrandUnit>;
export const IfMissing = z.enum(['call', 'similar', 'skip']);
export type IfMissing = z.infer<typeof IfMissing>;

/**
 * A shop the customer knows, by its name («صيدلية الشفاء», «مكتبة 30 تموز»). Four digits in a row
 * (Western or Arabic-Indic) are refused, so a phone number can never be stored here.
 */
export const KnownShopName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((v) => !/[0-9\u0660-\u0669\u06F0-\u06F9]{4,}/.test(v), {
    message: 'a shop name, not a number',
  });

/** An id in our own upload store (never an outside link). */
const UploadId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

/**
 * One «دوّرلي» item beyond its words (the line's `freeText`): how much, from where, what to do if the
 * shop has none, an optional top price, and a photo or voice note the customer uploaded to us. A shop
 * the customer knows is named and pinned; there are no names or phones of people here.
 */
export const ErrandItemSpec = z
  .object({
    unit: ErrandUnit,
    where: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('near') }),
      z.object({ kind: z.literal('app'), shopId: z.string().min(1).max(80) }),
      z.object({
        kind: z.literal('known'),
        name: KnownShopName,
        pin: z
          .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
          .nullable(),
      }),
    ]),
    ifMissing: IfMissing,
    maxIqd: Iqd.positive().nullable(),
    photoUploadId: UploadId.nullable(),
    voiceUploadId: UploadId.nullable(),
    voiceSec: z.number().int().min(1).max(120).nullable(),
    /** The whole list's ceiling (the same on every line of the order): over it the shopper calls first. */
    listMaxIqd: Iqd.positive().nullable().optional(),
  })
  .refine((v) => (v.voiceUploadId === null) === (v.voiceSec === null), {
    message: 'voiceSec goes with voiceUploadId',
  });
export type ErrandItemSpec = z.infer<typeof ErrandItemSpec>;

/** The shopping side's weights, limits and timings (`shopping-io.ts` re-exports it). No money rule here. */
export const SHOPPING_RULES = {
  /** The scale: quarter-kilo steps up to 3 kilos (round 2 «الميزان»). */
  weightStepG: WEIGHT_RULES.stepG,
  weightMaxG: WEIGHT_RULES.maxG,
  /** «وقّف شوية»: the pauses a baker can pick, in minutes. */
  pauseMinutes: [15, 30, 60] as const,
  /** «صمون كل يوم» delivery times (local hh:mm). */
  dailyBreadTimes: ['06:30', '13:00', '19:00'] as const,
  /** The order goes to the bakery this long before the delivery time. */
  dailyBreadLeadMin: 35,
  /** Standing bread orders one person may hold. */
  maxDailyBread: 5,
  /** Lots of one bread in one daily order. */
  maxDailyPacks: 20,
  /** Items a stall prices in one morning post. */
  maxPostItems: 60,
  /** A morning post counts as today's until local midnight. */
} as const;
