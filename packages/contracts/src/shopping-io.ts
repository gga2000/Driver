import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { PHOTO_MAX_BYTES, PhotoContentType, PhotoUploadTicket } from './account-io.js';
import { VOICE_RULES, VoiceContentType } from './chat-io.js';
import { MerchantScope } from './merchant-admin-io.js';
import { SHOPPING_RULES } from './shop-lines.js';

/**
 * The shopping side «السوق» (Ali, 2026-10-11): produce stalls «بسطيات» that photograph and price their
 * fruit and vegetables every morning, bakeries «أفران» that bake all day (open, paused or closed; no
 * batches, Ali 21:26Z), «صمون كل يوم» standing bread orders, and «دوّرلي» (any item from any shop, the
 * existing errand order).
 *
 * Money is what the city already has: a stall or bakery is a grocer org, so a basket or hot bread is a
 * `grocery_catalog` order priced by the `grocery` vertical, and دوّرلي is an `errand`. No new fee or rule:
 * `SHOPPING_RULES` only holds weights, limits and timings.
 */

/** Weights, limits and timings; it lives with the order lines so the apps' barrel carries it alone. */
export { SHOPPING_RULES };


export const ShopKind = z.enum(['produce_stall', 'bakery']);
export type ShopKind = z.infer<typeof ShopKind>;
export const SoldBy = z.enum(['kg', 'piece', 'lot']);
export type SoldBy = z.infer<typeof SoldBy>;
export const ShopState = z.enum(['open', 'paused', 'closed']);
export type ShopState = z.infer<typeof ShopState>;

// ───────────────────────── customer views ─────────────────────────

export const ProduceItemView = z.object({
  id: z.string(),
  name: z.string(),
  /** Today's photo when the stall took one, else the last one it took. */
  photo: z.string().nullable(),
  photoToday: z.boolean(),
  soldBy: z.enum(['kg', 'piece']),
  /** Per kilo (kg) or per piece. */
  priceIqd: Iqd,
  /** Yesterday's posted price; null when there was no post yesterday. */
  yesterdayIqd: Iqd.nullable(),
  /** «نفس البارحة»: today's post kept yesterday's price without a new look. */
  priceFromYesterday: z.boolean(),
  /** «تقريباً 6 إلى 7 طماطات» per kilo; null when the stall gave none. */
  piecesPerKg: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
  piecesWord: z.string().nullable(),
  available: z.boolean(),
});
export type ProduceItemView = z.infer<typeof ProduceItemView>;

export const StallView = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string(),
  rating: z.number().nullable(),
  /** Delivery minutes to the customer's place (prep + ride), rounded. */
  minutes: z.number().int().positive(),
  /** Local «6:12» of today's post; null before the stall posted today. */
  postedAt: z.string().nullable(),
  photo: z.string().nullable(),
  state: ShopState,
  items: z.array(ProduceItemView),
});
export type StallView = z.infer<typeof StallView>;

export const BakeryItemView = z.object({
  id: z.string(),
  name: z.string(),
  /** Pieces in one lot (4 صمون بـ 1,000). */
  per: z.number().int().positive(),
  /** Price of one lot. */
  priceIqd: Iqd,
  available: z.boolean(),
});
export type BakeryItemView = z.infer<typeof BakeryItemView>;

export const BakeryView = z.object({
  id: z.string(),
  name: z.string(),
  street: z.string(),
  state: ShopState,
  /** Open: closes at «11:00»; paused: back at «9:45»; closed: opens at «5:00». */
  closesAt: z.string().nullable(),
  resumesAt: z.string().nullable(),
  opensAt: z.string().nullable(),
  minutes: z.number().int().positive(),
  photo: z.string().nullable(),
  items: z.array(BakeryItemView),
});
export type BakeryView = z.infer<typeof BakeryView>;

export const ShoppingFront = z.object({
  bakeriesOpen: z.number().int().nonnegative(),
  stalls: z.array(StallView),
  bakeries: z.array(BakeryView),
});
export type ShoppingFront = z.infer<typeof ShoppingFront>;

export const ShoppingFrontInput = z.object({
  cityId: CityId,
  /** The customer's place, for the minutes; the town centre when absent. */
  near: DeliveryPoint.optional(),
});
export type ShoppingFrontInput = z.infer<typeof ShoppingFrontInput>;

export const ShopInput = z.object({ cityId: CityId, id: z.string().min(1), near: DeliveryPoint.optional() });
export type ShopInput = z.infer<typeof ShopInput>;

/** A shop دوّرلي can name («محل بالتطبيق»): any open storefront in town, restaurants included. */
export const AppShopView = z.object({ id: z.string(), name: z.string(), kind: z.string() });
export type AppShopView = z.infer<typeof AppShopView>;
export const AppShopsInput = z.object({ cityId: CityId, search: z.string().max(60).default('') });

/**
 * A signed upload for a «دوّرلي» item's photo (the old charger, the medicine box) or voice note, made
 * before the order exists. PUT the bytes, then send the `uploadId` in the line's `errandItem`; the
 * order is refused unless it is the orderer's own finished upload (`upload_invalid`).
 */
export const ErrandUploadInput = z
  .object({ contentType: z.union([PhotoContentType, VoiceContentType]), sizeBytes: z.number().int().positive() })
  .refine((v) => v.sizeBytes <= (VoiceContentType.safeParse(v.contentType).success ? VOICE_RULES.maxBytes : PHOTO_MAX_BYTES), { message: 'file too big' });
export type ErrandUploadInput = z.infer<typeof ErrandUploadInput>;

// ───────────────────────── «صمون كل يوم» ─────────────────────────

export const DailyBreadTime = z.enum(SHOPPING_RULES.dailyBreadTimes);
export type DailyBreadTime = z.infer<typeof DailyBreadTime>;
/** Days of the week, 0 = Sunday … 6 = Saturday (Baghdad). */
export const WeekDay = z.number().int().min(0).max(6);

export const DailyBreadInput = z.object({
  cityId: CityId,
  bakeryId: z.string().min(1),
  itemId: z.string().min(1),
  packs: z.number().int().min(1).max(SHOPPING_RULES.maxDailyPacks),
  time: DailyBreadTime,
  days: z.array(WeekDay).min(1).max(7),
  dropoff: DeliveryPoint,
  courierNote: z.string().max(300).optional(),
});
export type DailyBreadInput = z.infer<typeof DailyBreadInput>;

export const DailyBreadView = z.object({
  id: z.string(),
  bakeryId: z.string(),
  bakeryName: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  packs: z.number().int(),
  pieces: z.number().int(),
  time: DailyBreadTime,
  days: z.array(WeekDay),
  paused: z.boolean(),
  /** The bread's price for one day at today's price (delivery is priced each day by the server). */
  breadIqd: Iqd,
  /** The next day it comes (local date), null while paused. */
  nextOn: z.string().nullable(),
});
export type DailyBreadView = z.infer<typeof DailyBreadView>;

export const DailyBreadRef = z.object({ id: z.string().min(1) });
export const DailyBreadPatch = z.object({
  id: z.string().min(1),
  paused: z.boolean().optional(),
  packs: z.number().int().min(1).max(SHOPPING_RULES.maxDailyPacks).optional(),
  time: DailyBreadTime.optional(),
  days: z.array(WeekDay).min(1).max(7).optional(),
});
export type DailyBreadPatch = z.infer<typeof DailyBreadPatch>;

// ───────────────────────── Merchant app: shop mode ─────────────────────────

export const ShopModeView = z.object({ kind: ShopKind.nullable() });
export type ShopModeView = z.infer<typeof ShopModeView>;

/** One line of «أسعار اليوم» as the stall owner sees it. */
export const StallPriceRow = z.object({
  itemId: z.string(),
  name: z.string(),
  soldBy: z.enum(['kg', 'piece']),
  /** Today's price when posted, else yesterday's (to keep with «نفس البارحة»). */
  priceIqd: Iqd,
  yesterdayIqd: Iqd.nullable(),
  photo: z.string().nullable(),
  photoToday: z.boolean(),
  postedToday: z.boolean(),
  available: z.boolean(),
});
export type StallPriceRow = z.infer<typeof StallPriceRow>;

export const StallOwnerView = z.object({
  orgId: z.string(),
  name: z.string(),
  postedAt: z.string().nullable(),
  rows: z.array(StallPriceRow),
});
export type StallOwnerView = z.infer<typeof StallOwnerView>;

export const PostPricesInput = MerchantScope.extend({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        /** Today's price; absent = «نفس البارحة» (yesterday's price kept). */
        priceIqd: Iqd.positive().optional(),
        /** Today's photo (an uploaded photo link); absent keeps the last photo. */
        photoUrl: z.string().max(500).optional(),
        /** «خلص»: not selling it today. */
        available: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(SHOPPING_RULES.maxPostItems),
});
export type PostPricesInput = z.infer<typeof PostPricesInput>;

export const BakeryOwnerView = z.object({
  orgId: z.string(),
  name: z.string(),
  state: ShopState,
  resumesAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** «صمون كل يوم» pieces due today, by time. */
  dailyToday: z.array(z.object({ time: DailyBreadTime, pieces: z.number().int().nonnegative() })),
});
export type BakeryOwnerView = z.infer<typeof BakeryOwnerView>;

export const SetBakeryStateInput = MerchantScope.extend({
  state: ShopState,
  /** Paused: for how long. */
  pauseMin: z
    .number()
    .int()
    .refine((m) => (SHOPPING_RULES.pauseMinutes as readonly number[]).includes(m))
    .optional(),
});
export type SetBakeryStateInput = z.infer<typeof SetBakeryStateInput>;

// ───────────────────────── port ─────────────────────────

export interface ShoppingReader {
  actor: Actor | null;
}

export interface ShoppingPort {
  front(reader: ShoppingReader, input: ShoppingFrontInput): Promise<ShoppingFront>;
  stall(reader: ShoppingReader, input: ShopInput): Promise<StallView>;
  bakery(reader: ShoppingReader, input: ShopInput): Promise<BakeryView>;
  appShops(reader: ShoppingReader, input: z.output<typeof AppShopsInput>): Promise<AppShopView[]>;
  errandUpload(actor: Actor, input: ErrandUploadInput): Promise<PhotoUploadTicket>;
  dailyBreadMine(actor: Actor): Promise<DailyBreadView[]>;
  dailyBreadCreate(actor: Actor, input: DailyBreadInput): Promise<DailyBreadView>;
  dailyBreadUpdate(actor: Actor, input: DailyBreadPatch): Promise<DailyBreadView>;
  dailyBreadDelete(actor: Actor, input: z.output<typeof DailyBreadRef>): Promise<{ ok: true }>;
  mode(actor: Actor, input: MerchantScope): Promise<ShopModeView>;
  stallOwner(actor: Actor, input: MerchantScope): Promise<StallOwnerView>;
  postPrices(actor: Actor, input: PostPricesInput): Promise<StallOwnerView>;
  bakeryOwner(actor: Actor, input: MerchantScope): Promise<BakeryOwnerView>;
  setBakeryState(actor: Actor, input: SetBakeryStateInput): Promise<BakeryOwnerView>;
}
