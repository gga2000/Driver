import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { MerchantScope } from './merchant-admin-io.js';

/**
 * Food carts «عربانات» (Ali, 2026-10-11: "love it go ahead"): the laffa, kebda, falafel, corn, tea and
 * bagilla carts of Aziziyah. A cart moves and keeps its own hours, so it says where it opened tonight
 * («فتحت هنا») and people who follow it hear «أبو حيدر فتح». A customer walks over with a ticket
 * (cash at the cart) or has it delivered like any restaurant order.
 *
 * Money is the restaurants' (Ali's pick): a cart is a restaurant org on the base tier, so a delivery
 * order is commissioned by the existing orders path (12 %), and a walk-over ticket records the pickup
 * tier (5 %) of its total. No new rule and no fee: `FOOD_CART_RULES` only holds timings and limits.
 */

export const CartKind = z.enum(['liver', 'falafel', 'tea', 'corn', 'bagilla', 'cart']);
export type CartKind = z.infer<typeof CartKind>;

export const FOOD_CART_RULES = {
  /** Walking pace in town (m/min) and the street factor over a straight line. */
  walkMetersPerMin: 75,
  walkStreetFactor: 1.3,
  /** «قريبة منك»: within this many walking minutes. */
  nearWalkMin: 15,
  /** Usual minutes from ticket to «جاهزة» when the owner set no prep time of his own. */
  readyMin: { liver: 6, falafel: 5, tea: 2, corn: 4, bagilla: 3, cart: 5 } satisfies Record<CartKind, number>,
  /** A ticket nobody collected stops holding the food this long after it was ready (or placed). */
  holdMin: 45,
  /** One walk-over ticket: lines, pieces of one dish, and the note. */
  maxLines: 15,
  maxQty: 20,
  noteMaxChars: 120,
  /** Open walk-over tickets one person may hold at once (across carts). */
  maxOpenTickets: 3,
  /** A cart that forgot to close is shown closed this long after it opened. */
  maxOpenHours: 14,
  /** Carts one person may follow. */
  maxFollows: 50,
} as const;

/** Where the cart opened tonight; `facing` is the bearing from the cart to the street (map model). */
export const CartSpot = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** «جنب كراج السوق»; null when the owner named nothing (the app shows the zone). */
  label: z.string().max(60).nullable(),
  facing: z.number().min(0).max(360),
});
export type CartSpot = z.infer<typeof CartSpot>;

/** The owner's usual hours (Baghdad clock, "HH:MM"); `to` before `from` runs past midnight. */
export const CartUsualHours = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});
export type CartUsualHours = z.infer<typeof CartUsualHours>;

export const CartDish = z.object({
  itemId: z.string(),
  nameAr: z.string(),
  priceIqd: Iqd,
  available: z.boolean(),
  photoUrl: z.string().nullable(),
});
export type CartDish = z.infer<typeof CartDish>;

export const CartCard = z.object({
  id: z.string(),
  /** The restaurant org behind the cart: delivery orders go to it like any kitchen. */
  merchantOrgId: z.string(),
  name: z.string(),
  kind: CartKind,
  open: z.boolean(),
  /** Tonight's spot when open, else the last one (shown as «آخر مرة كانت هنا»); null before it ever opened. */
  spot: CartSpot.nullable(),
  usual: CartUsualHours.nullable(),
  /** «ترجع برمضان»-style line the owner wrote while away for the season; null otherwise. */
  awayNote: z.string().nullable(),
  openedAt: z.date().nullable(),
  /** When the owner said he closes tonight; null = he didn't say. */
  closesAt: z.date().nullable(),
  /** Walking minutes from the reader's point; null without one. */
  walkMin: z.number().int().nonnegative().nullable(),
  readyMin: z.number().int().positive(),
  following: z.boolean(),
  followers: z.number().int().nonnegative(),
  /** The first few dishes (cards) or the whole menu (the cart page). */
  dishes: z.array(CartDish),
  /** Delivery can be ordered now (open with a spot on file). */
  delivery: z.boolean(),
  /** Where a courier collects a delivery order (tonight's spot and its zone); null while closed. */
  pickup: DeliveryPoint.nullable(),
});
export type CartCard = z.infer<typeof CartCard>;

export const CartsInput = z.object({ cityId: CityId.default('aziziyah'), near: LatLng.optional() });
export type CartsInput = z.input<typeof CartsInput>;

/**
 * «عربانات العزيزية»: open now (nearest first), then closed ones; `followed` are the reader's own.
 * `launched` false: carts are not open in this city yet (both lists empty; the app says «جاية قريب»).
 */
export const CartsList = z.object({ open: z.array(CartCard), closed: z.array(CartCard), followedIds: z.array(z.string()), launched: z.boolean() });
export type CartsList = z.infer<typeof CartsList>;

export const CartInput = z.object({ cartId: z.string().min(1), near: LatLng.optional() });
export type CartInput = z.input<typeof CartInput>;

export const FollowCartInput = z.object({ cartId: z.string().min(1), on: z.boolean() });
export type FollowCartInput = z.infer<typeof FollowCartInput>;

export const WalkupState = z.enum(['placed', 'ready', 'collected', 'cancelled', 'expired']);
export type WalkupState = z.infer<typeof WalkupState>;
export const OPEN_WALKUP_STATES: readonly WalkupState[] = ['placed', 'ready'];

export const WalkupLineInput = z.object({ itemId: z.string().min(1), qty: z.number().int().min(1).max(FOOD_CART_RULES.maxQty) });
export const PlaceWalkupInput = z.object({
  cartId: z.string().min(1),
  lines: z.array(WalkupLineInput).min(1).max(FOOD_CART_RULES.maxLines),
  note: z.string().trim().max(FOOD_CART_RULES.noteMaxChars).optional(),
});
export type PlaceWalkupInput = z.infer<typeof PlaceWalkupInput>;

export const WalkupRef = z.object({ walkupId: z.string().min(1) });
export type WalkupRef = z.infer<typeof WalkupRef>;

export const WalkupLine = z.object({ itemId: z.string(), nameAr: z.string(), qty: z.number().int().positive(), priceIqd: Iqd });
export type WalkupLine = z.infer<typeof WalkupLine>;

/** A walk-over ticket as its customer sees it: the code he shows at the cart, cash on collection. */
export const WalkupView = z.object({
  id: z.string(),
  cartId: z.string(),
  cartName: z.string(),
  kind: CartKind,
  /** Three digits, said or shown at the cart. */
  code: z.string(),
  state: WalkupState,
  lines: z.array(WalkupLine),
  note: z.string().nullable(),
  totalIqd: Iqd,
  placedAt: z.date(),
  readyAt: z.date().nullable(),
  /** When it should be ready (placed + the cart's ready minutes); the app counts down to it. */
  readyBy: z.date(),
  spot: CartSpot.nullable(),
});
export type WalkupView = z.infer<typeof WalkupView>;

// ───────────────────────── owner (Merchant app cart mode) ─────────────────────────

/** A ticket on the owner's screen: by number, never a name or a phone. */
export const OwnerWalkupView = WalkupView.omit({ cartName: true, kind: true, spot: true });
export type OwnerWalkupView = z.infer<typeof OwnerWalkupView>;

export const CartOwnerView = z.object({
  cart: CartCard,
  /** Open tickets, oldest first. */
  walkups: z.array(OwnerWalkupView),
  /** Since tonight's opening: collected tickets and their cash. */
  tonight: z.object({ collected: z.number().int().nonnegative(), cashIqd: Iqd }),
});
export type CartOwnerView = z.infer<typeof CartOwnerView>;

export const OpenCartHereInput = MerchantScope.extend({
  at: LatLng,
  label: z.string().trim().max(60).optional(),
  facing: z.number().min(0).max(360).optional(),
  closesAt: z.date().optional(),
});
export type OpenCartHereInput = z.infer<typeof OpenCartHereInput>;

export const CartSettingsInput = MerchantScope.extend({
  usual: CartUsualHours.nullable().optional(),
  awayNote: z.string().trim().max(60).nullable().optional(),
});
export type CartSettingsInput = z.infer<typeof CartSettingsInput>;

export const OwnerWalkupInput = MerchantScope.extend({ walkupId: z.string().min(1) });
export type OwnerWalkupInput = z.infer<typeof OwnerWalkupInput>;
export const CollectWalkupInput = OwnerWalkupInput.extend({ code: z.string().regex(/^\d{3}$/) });
export type CollectWalkupInput = z.infer<typeof CollectWalkupInput>;

/** Is this org a cart (the Merchant app's mode switch)? */
export const CartModeView = z.object({ cart: z.boolean() });
export type CartModeView = z.infer<typeof CartModeView>;

// ───────────────────────── helpers ─────────────────────────

/** Walking minutes along streets between two points, at least one. */
export function walkMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  const m = 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * FOOD_CART_RULES.walkStreetFactor;
  return Math.max(1, Math.round(m / FOOD_CART_RULES.walkMetersPerMin));
}

// ───────────────────────── port ─────────────────────────

export interface FoodCartsReader {
  actor: Actor | null;
}

export interface FoodCartsPort {
  list(reader: FoodCartsReader, input: z.output<typeof CartsInput>): Promise<CartsList>;
  get(reader: FoodCartsReader, input: z.output<typeof CartInput>): Promise<CartCard>;
  follow(actor: Actor, input: FollowCartInput): Promise<{ following: boolean; followers: number }>;
  placeWalkup(actor: Actor, input: PlaceWalkupInput): Promise<WalkupView>;
  myWalkups(actor: Actor): Promise<WalkupView[]>;
  cancelWalkup(actor: Actor, input: WalkupRef): Promise<WalkupView>;
  mode(actor: Actor, input: MerchantScope): Promise<CartModeView>;
  owner(actor: Actor, input: MerchantScope): Promise<CartOwnerView>;
  openHere(actor: Actor, input: OpenCartHereInput): Promise<CartOwnerView>;
  close(actor: Actor, input: MerchantScope): Promise<CartOwnerView>;
  settings(actor: Actor, input: CartSettingsInput): Promise<CartOwnerView>;
  ready(actor: Actor, input: OwnerWalkupInput): Promise<CartOwnerView>;
  /** «ما أگدر هسه»: the cart turns a ticket down before it is ready (the customer is told). */
  reject(actor: Actor, input: OwnerWalkupInput): Promise<CartOwnerView>;
  collect(actor: Actor, input: CollectWalkupInput): Promise<CartOwnerView>;
}
