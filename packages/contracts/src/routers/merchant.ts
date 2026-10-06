import { z } from 'zod';
import { MerchantBoard, MerchantOrgInput, MerchantStore, PickupSpotView, SetBusyInput, SetPickupSpotInput, SetPrinterStatusInput, SetStoreHoursInput, SetStoreOpenInput, StoreHoursView, StoreStatusView } from '../merchant-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { MERCHANT_ROLES } from './orders.js';

/**
 * Driver Merchant (kitchen side). `myStores` is open to any signed-in person (an empty list is the
 * app's "not activated yet" screen); everything else needs a merchant role, and the API checks the
 * role is scoped to the store asked about. Not to be confused with `merchants` (the Console picker).
 */
export const merchantRouter = router({
  myStores: protectedProcedure().output(z.array(MerchantStore)).query(({ ctx }) => ctx.merchant.myStores(ctx.actor)),
  /** Active orders by column, grouped by person, with courier state and the accept deadline. Polled. */
  board: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantBoard).query(({ ctx, input }) => ctx.merchant.board(ctx.actor, input)),
  storeStatus: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(StoreStatusView).query(({ ctx, input }) => ctx.merchant.storeStatus(ctx.actor, input)),
  /** Open, or close early with a reason (sold out, too busy, no staff, power cut…). */
  setOpen: protectedProcedure(MERCHANT_ROLES).input(SetStoreOpenInput).output(StoreStatusView).mutation(({ ctx, input }) => ctx.merchant.setOpen(ctx.actor, input)),
  /** Busy mode: +10 min on every prep time until now + 60 min (or until switched off). */
  setBusy: protectedProcedure(MERCHANT_ROLES).input(SetBusyInput).output(StoreStatusView).mutation(({ ctx, input }) => ctx.merchant.setBusy(ctx.actor, input)),
  /** The tablet reports its receipt printer; "الطابعة مفصولة" shows on the board and to dispatch. */
  setPrinterStatus: protectedProcedure(MERCHANT_ROLES)
    .input(SetPrinterStatusInput)
    .output(StoreStatusView)
    .mutation(({ ctx, input }) => ctx.merchant.setPrinterStatus(ctx.actor, input)),
  /** Weekly schedule (split shifts), holiday closures and the Friday-prayer pause; open or closed now. */
  hours: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(StoreHoursView).query(({ ctx, input }) => ctx.merchant.hours(ctx.actor, input)),
  /** Owner only: replaces the schedule and closures; customers' cards and `orders.place` follow it. */
  setHours: protectedProcedure(MERCHANT_ROLES).input(SetStoreHoursInput).output(StoreHoursView).mutation(({ ctx, input }) => ctx.merchant.setHours(ctx.actor, input)),
  /** Where couriers collect orders (maps program r7): up to 2 photos and a short note. */
  pickupSpot: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(PickupSpotView).query(({ ctx, input }) => ctx.merchant.pickupSpot(ctx.actor, input)),
  /** Owner only: replaces the photos and note; the courier sees them on the pickup stop of his job. */
  setPickupSpot: protectedProcedure(MERCHANT_ROLES).input(SetPickupSpotInput).output(PickupSpotView).mutation(({ ctx, input }) => ctx.merchant.setPickupSpot(ctx.actor, input)),
});
