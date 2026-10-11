import { z } from 'zod';
import {
  AppShopView,
  AppShopsInput,
  BakeryOwnerView,
  BakeryView,
  DailyBreadInput,
  DailyBreadPatch,
  DailyBreadRef,
  DailyBreadView,
  ErrandUploadInput,
  PostPricesInput,
  SetBakeryStateInput,
  ShopInput,
  ShopModeView,
  ShoppingFront,
  ShoppingFrontInput,
  StallOwnerView,
  StallView,
  type ShoppingReader,
} from '../shopping-io.js';
import { PhotoUploadTicket } from '../account-io.js';
import { MerchantScope } from '../merchant-admin-io.js';
import { MERCHANT_ADMIN_ROLES } from './merchant-admin.js';
import { protectedProcedure, publicProcedure, router, type AppContext } from '../trpc.js';

function readerOf(ctx: AppContext): ShoppingReader {
  return { actor: ctx.auth ? { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) } : null };
}

/**
 * `shopping.*` «السوق» (Ali, 2026-10-11): stalls, bakeries and the shops دوّرلي can name are public
 * like the food catalog (guests browse); «صمون كل يوم» needs the phone. `owner.*` is the Merchant app's
 * shop mode (a stall's «أسعار اليوم», a baker's open / pause / close). Implementations: `modules/shopping`.
 * Baskets and hot bread are placed with `orders.place` (grocery_catalog); دوّرلي with `orders.place` (errand).
 */
export const shoppingRouter = router({
  front: publicProcedure.input(ShoppingFrontInput).output(ShoppingFront).query(({ ctx, input }) => ctx.shopping.front(readerOf(ctx), input)),
  stall: publicProcedure.input(ShopInput).output(StallView).query(({ ctx, input }) => ctx.shopping.stall(readerOf(ctx), input)),
  bakery: publicProcedure.input(ShopInput).output(BakeryView).query(({ ctx, input }) => ctx.shopping.bakery(readerOf(ctx), input)),
  appShops: publicProcedure.input(AppShopsInput).output(z.array(AppShopView)).query(({ ctx, input }) => ctx.shopping.appShops(readerOf(ctx), input)),
  errandUpload: protectedProcedure().input(ErrandUploadInput).output(PhotoUploadTicket).mutation(({ ctx, input }) => ctx.shopping.errandUpload(ctx.actor, input)),
  dailyBread: router({
    mine: protectedProcedure().output(z.array(DailyBreadView)).query(({ ctx }) => ctx.shopping.dailyBreadMine(ctx.actor)),
    create: protectedProcedure().input(DailyBreadInput).output(DailyBreadView).mutation(({ ctx, input }) => ctx.shopping.dailyBreadCreate(ctx.actor, input)),
    update: protectedProcedure().input(DailyBreadPatch).output(DailyBreadView).mutation(({ ctx, input }) => ctx.shopping.dailyBreadUpdate(ctx.actor, input)),
    remove: protectedProcedure().input(DailyBreadRef).output(z.object({ ok: z.literal(true) })).mutation(({ ctx, input }) => ctx.shopping.dailyBreadDelete(ctx.actor, input)),
  }),
  owner: router({
    mode: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(ShopModeView).query(({ ctx, input }) => ctx.shopping.mode(ctx.actor, input)),
    stall: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(StallOwnerView).query(({ ctx, input }) => ctx.shopping.stallOwner(ctx.actor, input)),
    postPrices: protectedProcedure(MERCHANT_ADMIN_ROLES).input(PostPricesInput).output(StallOwnerView).mutation(({ ctx, input }) => ctx.shopping.postPrices(ctx.actor, input)),
    bakery: protectedProcedure(MERCHANT_ADMIN_ROLES).input(MerchantScope).output(BakeryOwnerView).query(({ ctx, input }) => ctx.shopping.bakeryOwner(ctx.actor, input)),
    setBakeryState: protectedProcedure(MERCHANT_ADMIN_ROLES).input(SetBakeryStateInput).output(BakeryOwnerView).mutation(({ ctx, input }) => ctx.shopping.setBakeryState(ctx.actor, input)),
  }),
});
