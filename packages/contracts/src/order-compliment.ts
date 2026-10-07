import { z } from 'zod';
import { FOOD_RATED_TYPES, OrderIdInput, type Order, type OrderState, type OrderType } from './order.js';

/**
 * «شنو عجبك بـ حيدر؟» — one-tap compliments after a good rating (joy l4, research S-4 / D8). The
 * customer picks a few kind words about the courier or driver who brought the order; the courier sees
 * them (a push, his shift summary and «كلام الزبائن» in the Partner app). Presets only, never free
 * text (safety); no money. One set per order. docs/api/compliments-and-live.md.
 */

/** The words, stored as keys; the apps carry the copy (`compliment.<key>`). */
export const ComplimentKey = z.enum(['fast', 'polite', 'hot_food', 'found_home', 'smooth_ride', 'clean_car']);
export type ComplimentKey = z.infer<typeof ComplimentKey>;

const FOOD_KEYS: readonly ComplimentKey[] = ['fast', 'polite', 'hot_food', 'found_home'];
const RIDE_KEYS: readonly ComplimentKey[] = ['polite', 'smooth_ride', 'clean_car', 'fast'];
const DELIVERY_KEYS: readonly ComplimentKey[] = ['fast', 'polite', 'found_home'];

/** The chips an order offers, in the order the app shows them. */
export function complimentKeysFor(type: OrderType): readonly ComplimentKey[] {
  if (type === 'ride') return RIDE_KEYS;
  if ((FOOD_RATED_TYPES as readonly string[]).includes(type)) return FOOD_KEYS;
  return DELIVERY_KEYS;
}

/**
 * The rules (not money): asked only after the customer rated the courier/driver `minRating` or more,
 * within `windowHours` of delivery, at most `maxKeys` words.
 */
export const COMPLIMENT_RULES = { minRating: 4, windowHours: 24, maxKeys: 4 } as const;

/** Why the app shows no compliment chips (null when it does). */
export const ComplimentReason = z.enum(['not_delivered', 'not_rated', 'low_rating', 'window_closed', 'no_driver']);
export type ComplimentReason = z.infer<typeof ComplimentReason>;

/** States where the order reached the customer: food delivered (then closed by the rating), a ride completed. */
const REACHED: readonly OrderState[] = ['delivered', 'closed', 'completed'];

const HOUR_MS = 3_600_000;

/** The last moment compliments can be sent for an order (null when it never reached the customer). */
export function complimentUntil(order: Pick<Order, 'deliveredAt'>): Date | null {
  return order.deliveredAt ? new Date(order.deliveredAt.getTime() + COMPLIMENT_RULES.windowHours * HOUR_MS) : null;
}

/** Why compliments are not asked for this order now; null when they are (a courier must also have carried it). */
export function complimentReason(order: Pick<Order, 'state' | 'deliveredAt' | 'rating'>, now: Date): ComplimentReason | null {
  if (!REACHED.includes(order.state) || !order.deliveredAt) return 'not_delivered';
  const score = order.rating?.delivery;
  if (!order.rating || typeof score !== 'number') return 'not_rated';
  if (score < COMPLIMENT_RULES.minRating) return 'low_rating';
  const until = complimentUntil(order);
  if (until && now.getTime() > until.getTime()) return 'window_closed';
  return null;
}

export const ComplimentSent = z.object({ keys: z.array(ComplimentKey).min(1), at: z.coerce.date() });
export type ComplimentSent = z.infer<typeof ComplimentSent>;

export const ComplimentOffer = z.object({
  orderId: z.string(),
  /** The chips show (or he already sent some: the app then thanks him). */
  offered: z.boolean(),
  reason: ComplimentReason.nullable(),
  /** The chips this order offers, in order. Empty when not offered. */
  keys: z.array(ComplimentKey),
  untilAt: z.coerce.date().nullable(),
  /** What he already sent on this order. */
  sent: ComplimentSent.nullable(),
});
export type ComplimentOffer = z.infer<typeof ComplimentOffer>;

export const ComplimentInput = OrderIdInput.extend({ keys: z.array(ComplimentKey).min(1).max(COMPLIMENT_RULES.maxKeys) });
export type ComplimentInput = z.infer<typeof ComplimentInput>;

export const ComplimentResult = z.object({ orderId: z.string(), keys: z.array(ComplimentKey).min(1), at: z.coerce.date() });
export type ComplimentResult = z.infer<typeof ComplimentResult>;

/** One key and how many customers said it. */
export const ComplimentCount = z.object({ key: ComplimentKey, count: z.number().int().positive() });
export type ComplimentCount = z.infer<typeof ComplimentCount>;

/** Counts, most said first (ties in `ComplimentKey` order). */
export function countCompliments(rows: ReadonlyArray<{ keys: readonly ComplimentKey[] }>): ComplimentCount[] {
  const n = new Map<ComplimentKey, number>();
  for (const r of rows) for (const k of new Set(r.keys)) n.set(k, (n.get(k) ?? 0) + 1);
  const order = ComplimentKey.options;
  return [...n.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || order.indexOf(a.key) - order.indexOf(b.key));
}

/** «كلام الزبائن» in the Partner app: all his compliments counted, and the latest ones. */
export const CourierCompliments = z.object({
  /** How many customers sent him compliments, ever. */
  customers: z.number().int().min(0),
  counts: z.array(ComplimentCount),
  /** Newest first, at most `COURIER_COMPLIMENTS_RECENT`. No customer name: the words, the ticket and when. */
  recent: z.array(z.object({ keys: z.array(ComplimentKey).min(1), at: z.coerce.date(), ticket: z.string(), orderType: z.string() })),
});
export type CourierCompliments = z.infer<typeof CourierCompliments>;

export const COURIER_COMPLIMENTS_RECENT = 20;
