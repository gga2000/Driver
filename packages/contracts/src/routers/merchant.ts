import { z } from 'zod';
import { CustomerZonesInput, MerchantBoard, MerchantCustomerZones, MerchantDeliveryArea, MerchantOrgInput, MerchantStore, PickupSpotView, SetBusyInput, SetPickupSpotInput, SetPrinterStatusInput, SetStoreHoursInput, SetStoreOpenInput, StoreHoursView, StoreStatusView } from '../merchant-io.js';
import { MenuCards, MerchantSetupView, SetupAnswerInput, SetupCheckInput, SetupDishPhotoInput, SetupKindsInput, SetupMenuDraftInput, SetupShopPhotoInput, SetupStartMenuInput } from '../merchant-setup-io.js';
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
  /** «منطقة التوصيل» (maps program r5): zones with the server's fee from this kitchen; read-only, owner and staff. */
  deliveryArea: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantDeliveryArea).query(({ ctx, input }) => ctx.merchant.deliveryArea(ctx.actor, input)),
  /** «منين زبائنك» (maps program r6): delivered orders per area, zones under 5 orders hidden (D7). Owner only (the API refuses staff, like money). */
  customerZones: protectedProcedure(MERCHANT_ROLES).input(CustomerZonesInput).output(MerchantCustomerZones).query(({ ctx, input }) => ctx.merchant.customerZones(ctx.actor, input)),
  /**
   * «جهّز محلك»: the new shop's first day. Owner only (staff never see setup; the API refuses them).
   * Nothing here changes money; going live opens the shop like the open switch, once every step is done.
   */
  setup: router({
    get: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantSetupView).query(({ ctx, input }) => ctx.merchantSetup.get(ctx.actor, input)),
    /** «شنو تبيع؟»: the four doors, one or more; writes the storefront's tags. */
    confirmKinds: protectedProcedure(MERCHANT_ROLES).input(SetupKindsInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.confirmKinds(ctx.actor, input)),
    /** The kitchen runway's checks: sound heard, screen stays on, practice order handed over, printer later. */
    check: protectedProcedure(MERCHANT_ROLES).input(SetupCheckInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.check(ctx.actor, input)),
    /** He has seen how his money reaches him (the way field ops set it); no money rule changes. */
    seePayout: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.seePayout(ctx.actor, input)),
    shopPhoto: protectedProcedure(MERCHANT_ROLES).input(SetupShopPhotoInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.shopPhoto(ctx.actor, input)),
    /** A photo for a dish that has none: his own, or one from Driver's library («صورة توضيحية» to customers). */
    dishPhoto: protectedProcedure(MERCHANT_ROLES).input(SetupDishPhotoInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.dishPhoto(ctx.actor, input)),
    /** The yes/fix cards read from his menu photos; nothing is on the menu until he says صح. */
    menuCards: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MenuCards).query(({ ctx, input }) => ctx.merchantSetup.menuCards(ctx.actor, input)),
    startMenu: protectedProcedure(MERCHANT_ROLES).input(SetupStartMenuInput).output(MenuCards).mutation(({ ctx, input }) => ctx.merchantSetup.startMenu(ctx.actor, input)),
    menuDraft: protectedProcedure(MERCHANT_ROLES).input(SetupMenuDraftInput).output(MenuCards).mutation(({ ctx, input }) => ctx.merchantSetup.menuDraft(ctx.actor, input)),
    answer: protectedProcedure(MERCHANT_ROLES).input(SetupAnswerInput).output(MenuCards).mutation(({ ctx, input }) => ctx.merchantSetup.answer(ctx.actor, input)),
    /** «ارفع الكبنك»: every step done (`setup_not_ready` otherwise); the shop opens for customers. */
    goLive: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.goLive(ctx.actor, input)),
    /** The gold first-order ribbon has done its job. */
    firstOrderSeen: protectedProcedure(MERCHANT_ROLES).input(MerchantOrgInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.merchantSetup.firstOrderSeen(ctx.actor, input)),
  }),
});
