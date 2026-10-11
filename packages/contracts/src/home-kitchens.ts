import { z } from 'zod';

/**
 * أكل بيت (Ali, 2026-10-11): women in Aziziyah who cook at home sell their own small menus. A home
 * kitchen is an ordinary food shop (same orders, fees, couriers and money) with two kinds of dish:
 *
 * - `ready` («جاهز هسه»): cooked today; she says how many plates she made and customers order until
 *   they run out (the item's stock is the plates left).
 * - `reserve` («بالحجز»): cooked only when booked. She says how far ahead it must be booked, the days
 *   she cooks it, the pickup times and the most plates per time; the customer picks a day and a time
 *   and the order is an ordinary pre-order (`scheduledFor`) at that time.
 *
 * Her home is never shown: customers see the kitchen's name, dishes and distance only, and the
 * courier gets the door for the pickup alone. Pure rules, shared by the app and the server.
 */

export const HOME_KITCHEN_RULES = {
  /** The cook's line under a dish name (Ali 01:02Z: «سطر يشرح الأكلة»). */
  descriptionMax: 60,
  /** «شنو بالصحن؟» (optional), e.g. «نص كيلو لحم». */
  portionMax: 30,
  /** How far ahead a reserve dish can require booking: 4 hours, a day, two days. */
  aheadOptionsMin: [240, 1440, 2880] as const,
  /** Pickup times a dish can have. */
  maxTimes: 4,
  /** Most plates one pickup time can take. */
  maxPerSlot: 50,
  /** How many days ahead the customer can book. */
  bookDays: 7,
  /** Most plates she can say she cooked today. */
  maxCooked: 200,
} as const;

/** The city's fixed offset (Iraq keeps UTC+3 all year). */
export const HOME_KITCHEN_UTC_OFFSET_MIN = 180;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const HomeSaleMode = z.enum(['ready', 'reserve']);
export type HomeSaleMode = z.infer<typeof HomeSaleMode>;

/** A reserve dish's booking rule, as the cook set it. */
export const ReserveRule = z.object({
  aheadMin: z.number().int().min(0).max(7 * 1440),
  /** Local days of the week she cooks it (0 = Sunday). */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  /** Local pickup times, "HH:MM". */
  times: z.array(HHMM).min(1).max(HOME_KITCHEN_RULES.maxTimes),
  maxPerSlot: z.number().int().min(1).max(HOME_KITCHEN_RULES.maxPerSlot),
});
export type ReserveRule = z.infer<typeof ReserveRule>;

/** One pickup time a customer can book, and how many plates are still free at it. */
export const HomeSlot = z.object({ at: z.coerce.date(), left: z.number().int().min(0) });
export type HomeSlot = z.infer<typeof HomeSlot>;

/** What the customer menu says about a home dish. */
export const HomeDishView = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ready'),
    /** Plates she cooked today; null when she didn't say (then only `left` shows). */
    cooked: z.number().int().min(0).nullable(),
    /** Plates still free today (the item's stock). */
    left: z.number().int().min(0),
  }),
  z.object({
    mode: z.literal('reserve'),
    aheadMin: z.number().int().min(0),
    /** The earliest time with a plate free; null when the coming week is fully booked. */
    next: HomeSlot.nullable(),
  }),
]);
export type HomeDishView = z.infer<typeof HomeDishView>;

/** What a kitchen card says about a home kitchen. */
export const HomeKitchenBadge = z.object({
  /** One letter shown instead of a face. */
  monogram: z.string().min(1).max(2),
  /** Dishes with plates left today. */
  readyCount: z.number().int().min(0),
  /** Dishes taking reservations. */
  reserveCount: z.number().int().min(0),
});
export type HomeKitchenBadge = z.infer<typeof HomeKitchenBadge>;

export const HomeSlotsInput = z.object({ merchantId: z.string().min(1), itemId: z.string().min(1) });
export type HomeSlotsInput = z.input<typeof HomeSlotsInput>;

/** A reserve dish's bookable week: each cooking day with its pickup times. */
export const HomeSlots = z.object({
  aheadMin: z.number().int().min(0),
  days: z.array(z.object({ day: z.string(), dow: z.number().int().min(0).max(6), slots: z.array(HomeSlot) })),
});
export type HomeSlots = z.infer<typeof HomeSlots>;

const MIN = 60_000;
const DAY = 1440 * MIN;

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The local calendar day ("YYYY-MM-DD") of an instant. */
export function homeLocalDay(at: Date, offsetMin: number = HOME_KITCHEN_UTC_OFFSET_MIN): string {
  return new Date(at.getTime() + offsetMin * MIN).toISOString().slice(0, 10);
}

/** The slot key the server counts bookings under (the instant, to the minute). */
export function slotKey(at: Date): string {
  return new Date(Math.floor(at.getTime() / MIN) * MIN).toISOString();
}

/**
 * The bookable pickup times of a reserve dish over the next `HOME_KITCHEN_RULES.bookDays` days: on
 * the days she cooks it, at her times, at least `aheadMin` from now, each with the plates still free
 * (`booked` counts plates already reserved per `slotKey`). Days with no time left out; full times kept
 * with `left: 0` so the customer sees them taken.
 */
export function reserveSlots(rule: ReserveRule, now: Date, booked: ReadonlyMap<string, number> = new Map(), offsetMin: number = HOME_KITCHEN_UTC_OFFSET_MIN): HomeSlots['days'] {
  const localNow = now.getTime() + offsetMin * MIN;
  const today = Math.floor(localNow / DAY) * DAY;
  const times = [...new Set(rule.times)].sort((a, b) => toMin(a) - toMin(b));
  const out: HomeSlots['days'] = [];
  for (let d = 0; d <= HOME_KITCHEN_RULES.bookDays; d++) {
    const dayStart = today + d * DAY;
    const dow = new Date(dayStart).getUTCDay();
    if (!rule.days.includes(dow)) continue;
    const slots: HomeSlot[] = [];
    for (const t of times) {
      const at = new Date(dayStart + toMin(t) * MIN - offsetMin * MIN);
      if (at.getTime() - now.getTime() < rule.aheadMin * MIN) continue;
      const left = Math.max(0, rule.maxPerSlot - (booked.get(slotKey(at)) ?? 0));
      slots.push({ at, left });
    }
    if (slots.length > 0) out.push({ day: new Date(dayStart).toISOString().slice(0, 10), dow, slots });
  }
  return out;
}

/** The earliest bookable time with a plate free, or null. */
export function nextReserveSlot(rule: ReserveRule, now: Date, booked?: ReadonlyMap<string, number>, offsetMin?: number): HomeSlot | null {
  for (const day of reserveSlots(rule, now, booked, offsetMin))
    for (const s of day.slots) if (s.left > 0) return s;
  return null;
}

/** Whether `at` is one of the dish's bookable times right now (what `orders.place` checks). */
export function isReserveSlot(rule: ReserveRule, now: Date, at: Date, offsetMin?: number): boolean {
  const key = slotKey(at);
  return reserveSlots(rule, now, new Map(), offsetMin).some((d) => d.slots.some((s) => slotKey(s.at) === key));
}

/**
 * The letter on a kitchen's badge: the first letter of the last word of its name («مطبخ أم حسين» →
 * «ح»), skipping «ال». The cook can choose her own.
 */
export function kitchenMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = (words[words.length - 1] ?? '').replace(/^ال(?=.)/, '');
  return Array.from(last)[0] ?? '·';
}
