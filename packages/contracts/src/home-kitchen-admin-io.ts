import { z } from 'zod';
import { Iqd, LatLng } from './common.js';
import { HOME_KITCHEN_RULES, HomeDishView, ReserveRule } from './home-kitchens.js';
import { MerchantScope } from './merchant-admin-io.js';

/**
 * أكل بيت, the cook's side (Merchant app, home-kitchen mode): her dishes with how each sells, today's
 * plates, and the reservations coming. Owner and staff read; the owner saves dishes; owner and staff
 * set today's plates (a kitchen's daily switch).
 */

/** How a dish sells, as the cook sets it: ready today (plates set day by day) or by reservation. */
export const HomeDishSaleInput = z.discriminatedUnion('mode', [z.object({ mode: z.literal('ready') }), z.object({ mode: z.literal('reserve'), rule: ReserveRule })]);
export type HomeDishSaleInput = z.infer<typeof HomeDishSaleInput>;

/** «أكلة جديدة» / edit: name, her line, «يشبّع», what's on the plate, price, and how it sells. */
export const SaveHomeDishInput = MerchantScope.extend({
  /** Absent = a new dish. */
  itemId: z.string().min(1).optional(),
  nameAr: z.string().trim().min(1).max(40),
  description: z.string().trim().max(HOME_KITCHEN_RULES.descriptionMax).nullable(),
  servesMin: z.number().int().min(1).max(50).nullable(),
  servesMax: z.number().int().min(1).max(50).nullable(),
  portion: z.string().trim().max(HOME_KITCHEN_RULES.portionMax).nullable(),
  priceIqd: Iqd.positive().max(1_000_000),
  sale: HomeDishSaleInput,
});
export type SaveHomeDishInput = z.infer<typeof SaveHomeDishInput>;

/**
 * «جاهزة اليوم»: how many plates of a ready dish she has now (null = not cooking it today). `cooked`
 * is how many she made, when she says (shown to customers as the dots).
 */
export const SetHomeTodayInput = MerchantScope.extend({
  itemId: z.string().min(1),
  left: z.number().int().min(0).max(HOME_KITCHEN_RULES.maxCooked).nullable(),
  cooked: z.number().int().min(0).max(HOME_KITCHEN_RULES.maxCooked).nullable().optional(),
});
export type SetHomeTodayInput = z.infer<typeof SetHomeTodayInput>;

export const HomeKitchenDish = z.object({
  id: z.string(),
  nameAr: z.string(),
  description: z.string().nullable(),
  priceIqd: Iqd,
  photoUrl: z.string().nullable(),
  servesMin: z.number().int().nullable(),
  servesMax: z.number().int().nullable(),
  portion: z.string().nullable(),
  /** Her toggle for the dish as a whole (off = hidden from customers). */
  available: z.boolean(),
  sale: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('ready'), cooked: z.number().int().nullable(), cookingToday: z.boolean() }),
    z.object({ mode: z.literal('reserve'), rule: ReserveRule }),
  ]),
  /** What customers see now (plates left, or the next free time). */
  view: HomeDishView,
  /** Reserved plates still to come for this dish. */
  booked: z.number().int().min(0),
});
export type HomeKitchenDish = z.infer<typeof HomeKitchenDish>;

/** One pickup time she has to cook for: the dish, plates and how many orders. */
export const HomeKitchenSlot = z.object({ at: z.coerce.date(), itemId: z.string(), nameAr: z.string(), plates: z.number().int().min(1), orders: z.number().int().min(1) });
export type HomeKitchenSlot = z.infer<typeof HomeKitchenSlot>;

export const HomeKitchenView = z.object({
  /** False for a restaurant: nothing else is filled. */
  home: z.boolean(),
  dishes: z.array(HomeKitchenDish),
  /** Coming reservations, soonest first. */
  reservations: z.array(HomeKitchenSlot),
});
export type HomeKitchenView = z.infer<typeof HomeKitchenView>;

/**
 * «سجّلي مطبخج» (أكل بيت, cook sign-up from the Merchant app): the kitchen's name, the cook's name
 * (to the identity vault only) and her door. Never a commission, tier or price: the 10% home rate is
 * set by the server after a staff reviewer approves (lane A). One application per person at a time.
 */
export const HomeKitchenApplyInput = z.object({
  cityId: z.string().min(1),
  kitchenName: z.string().trim().min(2).max(40),
  cookName: z.string().trim().min(1).max(40),
  /** Her door; the server reads the zone from it. Only couriers see it, at pickup. */
  door: LatLng,
  /** «قرب شنو؟»: a landmark that helps the courier find the door (optional). */
  landmark: z.string().trim().max(80).optional(),
});
export type HomeKitchenApplyInput = z.infer<typeof HomeKitchenApplyInput>;

/** Her application as she sees it: none yet, waiting for a call, or turned down (with why). */
export const HomeKitchenApplication = z.object({
  state: z.enum(['none', 'submitted', 'active', 'rejected']),
  kitchenName: z.string().nullable(),
  submittedAt: z.coerce.date().nullable(),
  rejectReason: z.string().nullable(),
});
export type HomeKitchenApplication = z.infer<typeof HomeKitchenApplication>;
