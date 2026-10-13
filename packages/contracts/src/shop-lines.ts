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
  /**
   * «دوّرلي» on a bike (Ali 2026-10-12): up to 15 pieces, where a food order's bike limit is 6. The
   * bike's value limit (25,000) is unchanged; above either the errand needs a tuktuk.
   */
  errandBikeMaxPieces: 15,
} as const;

/** What a «دوّرلي» shopper won't fetch (Ali 2026-10-12): medicines, cigarettes and gas cylinders. */
export const ERRAND_WONT_FETCH = ['medicine', 'cigarettes', 'gas'] as const;
export type ErrandWontFetch = (typeof ERRAND_WONT_FETCH)[number];

/** Spoken and written words for each, after `normaliseArabic` (ة→ه, أ/إ/آ→ا, گ/ک→ك, ى/ی/ئ→ي, no ء; Latin lower-cased). */
const WONT_FETCH_WORDS: Readonly<Record<ErrandWontFetch, readonly string[]>> = {
  medicine: ['دوا', 'دوه', 'دواي', 'ادويه', 'علاج', 'صيدليه', 'بنادول', 'panadol', 'بروفين', 'brufen'],
  cigarettes: ['جكاير', 'جكايير', 'جكاره', 'سكاير', 'سكاره', 'سجاير', 'سجاره', 'سيجاره', 'سيكاره', 'تتن', 'معسل'],
  gas: ['غاز'],
};

function normaliseArabic(word: string): string {
  return word
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/[گکك]/g, 'ك')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ؤ/g, 'و')
    .toLowerCase();
}

const PREFIXES = ['وبال', 'بال', 'وال', 'لل', 'ال', 'و', 'ب'] as const;

/**
 * Which kind of thing the shopper won't fetch an item's words name, or null. Whole words only, so
 * «مشروب غازي» or «غازية» is not a gas cylinder; a leading و / ال / بال is looked through.
 */
export function errandWontFetch(text: string): ErrandWontFetch | null {
  for (const w of normaliseArabic(text).split(/[^\p{L}]+/u)) {
    if (!w) continue;
    const forms = [w, ...PREFIXES.filter((p) => w.startsWith(p) && w.length - p.length >= 3).map((p) => w.slice(p.length))];
    for (const kind of ERRAND_WONT_FETCH) {
      if (forms.some((f) => WONT_FETCH_WORDS[kind].includes(f))) return kind;
    }
  }
  return null;
}
