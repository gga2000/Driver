import { z } from 'zod';
import {
  CartCard,
  CartInput,
  CartModeView,
  CartOwnerView,
  CartSettingsInput,
  CartsInput,
  CartsList,
  CollectWalkupInput,
  FollowCartInput,
  OpenCartHereInput,
  OwnerWalkupInput,
  PlaceWalkupInput,
  WalkupRef,
  WalkupView,
  type FoodCartsReader,
} from '../food-carts-io.js';
import { MerchantScope } from '../merchant-admin-io.js';
import { MERCHANT_ADMIN_ROLES } from './merchant-admin.js';
import { protectedProcedure, publicProcedure, router, type AppContext } from '../trpc.js';

function readerOf(ctx: AppContext): FoodCartsReader {
  return { actor: ctx.auth ? { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) } : null };
}

/**
 * `foodCarts.*` «عربانات» (Ali, 2026-10-11): the list and a cart's page are public like the food
 * catalog (guests browse; «تابع» and a ticket ask for the phone). `owner.*` is the Merchant app's cart
 * mode, for the cart's owner and staff. Implementations live in `modules/food-carts`.
 */
export const foodCartsRouter = router({
  list: publicProcedure.input(CartsInput).output(CartsList).query(({ ctx, input }) => ctx.foodCarts.list(readerOf(ctx), input)),
  get: publicProcedure.input(CartInput).output(CartCard).query(({ ctx, input }) => ctx.foodCarts.get(readerOf(ctx), input)),
  follow: protectedProcedure()
    .input(FollowCartInput)
    .output(z.object({ following: z.boolean(), followers: z.number().int().nonnegative() }))
    .mutation(({ ctx, input }) => ctx.foodCarts.follow(ctx.actor, input)),
  walkups: router({
    place: protectedProcedure().input(PlaceWalkupInput).output(WalkupView).mutation(({ ctx, input }) => ctx.foodCarts.placeWalkup(ctx.actor, input)),
    mine: protectedProcedure().output(z.array(WalkupView)).query(({ ctx }) => ctx.foodCarts.myWalkups(ctx.actor)),
    cancel: protectedProcedure().input(WalkupRef).output(WalkupView).mutation(({ ctx, input }) => ctx.foodCarts.cancelWalkup(ctx.actor, input)),
  }),
  owner: router({
    mode: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(CartModeView).query(({ ctx, input }) => ctx.foodCarts.mode(ctx.actor, input)),
    get: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(CartOwnerView).query(({ ctx, input }) => ctx.foodCarts.owner(ctx.actor, input)),
    openHere: protectedProcedure(MERCHANT_ADMIN_ROLES).input(OpenCartHereInput).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.openHere(ctx.actor, input)),
    close: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.close(ctx.actor, input)),
    settings: protectedProcedure(MERCHANT_ADMIN_ROLES).input(CartSettingsInput).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.settings(ctx.actor, input)),
    ready: protectedProcedure(MERCHANT_ADMIN_ROLES).input(OwnerWalkupInput).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.ready(ctx.actor, input)),
    reject: protectedProcedure(MERCHANT_ADMIN_ROLES).input(OwnerWalkupInput).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.reject(ctx.actor, input)),
    collect: protectedProcedure(MERCHANT_ADMIN_ROLES).input(CollectWalkupInput).output(CartOwnerView).mutation(({ ctx, input }) => ctx.foodCarts.collect(ctx.actor, input)),
  }),
});
