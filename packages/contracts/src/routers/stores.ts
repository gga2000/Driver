import { z } from 'zod';
import { AdminMenu, AdminMenuItem, MenuItemIdInput, MerchantScope, ReorderCategoriesInput, SetAvailabilityInput, SetModifiersInput, UpsertCategoryInput, UpsertItemInput } from '../merchant-admin-io.js';
import { MerchantOrgInput, StoreHoursView, StoreStatusView } from '../merchant-io.js';
import { MerchantSetupView } from '../merchant-setup-io.js';
import { AddItemsInput, LibraryPhotoInput, OpsDishPhotoInput, OpsSetBusyInput, OpsSetHoursInput, OpsSetOpenInput, OpsSetupKindsInput, OpsShopPhotoInput, OpsStoreInput, STORE_SETUP_EDIT_ROLES, STORE_SETUP_READ_ROLES, StoreHistoryEntry, StoreHistoryInput, StoreRow, StoresInput } from '../store-setup-io.js';
import { protectedProcedure, router } from '../trpc.js';

const read = protectedProcedure(STORE_SETUP_READ_ROLES);
const edit = protectedProcedure(STORE_SETUP_EDIT_ROLES);

/**
 * `ops.stores.*` — Console › المطاعم (Ali, 2026-10-21): Driver's team sets a restaurant up and keeps its
 * menu for the owner. Field ops and admins change, support reads. The owner's own rules apply, each
 * change is audited under the staff member's name, and prices of a shop already open stay the owner's.
 */
export const opsStoresRouter = router({
  list: read.input(StoresInput).output(z.array(StoreRow)).query(({ ctx, input }) => ctx.stores.list(ctx.actor, input)),
  /** «السجل»: who changed what on this store, newest first. */
  history: read.input(StoreHistoryInput).output(z.array(StoreHistoryEntry)).query(({ ctx, input }) => ctx.stores.history(ctx.actor, input)),
  menu: read.input(MerchantScope).output(AdminMenu).query(({ ctx, input }) => ctx.stores.menu(ctx.actor, input)),
  upsertItem: edit.input(UpsertItemInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.stores.upsertItem(ctx.actor, input)),
  /** «الصق المنيو»: many dishes in one go. */
  addItems: edit.input(AddItemsInput).output(AdminMenu).mutation(({ ctx, input }) => ctx.stores.addItems(ctx.actor, input)),
  upsertCategory: edit.input(UpsertCategoryInput).output(AdminMenu).mutation(({ ctx, input }) => ctx.stores.upsertCategory(ctx.actor, input)),
  reorderCategories: edit.input(ReorderCategoriesInput).output(AdminMenu).mutation(({ ctx, input }) => ctx.stores.reorderCategories(ctx.actor, input)),
  setModifiers: edit.input(SetModifiersInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.stores.setModifiers(ctx.actor, input)),
  setAvailability: edit.input(SetAvailabilityInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.stores.setAvailability(ctx.actor, input)),
  soldOutToday: edit.input(MenuItemIdInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.stores.soldOutToday(ctx.actor, input)),
  /** «من صورنا»: a library photo as the dish's «صورة توضيحية». */
  libraryPhoto: edit.input(LibraryPhotoInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.stores.libraryPhoto(ctx.actor, input)),

  // The shop itself, for the owner (merchant module's `ops*` methods: the owner's rules; his practice
  // order, sound check and payout stay his).
  setup: read.input(MerchantOrgInput).output(MerchantSetupView).query(({ ctx, input }) => ctx.stores.setup(ctx.actor, input)),
  status: read.input(MerchantOrgInput).output(StoreStatusView).query(({ ctx, input }) => ctx.stores.status(ctx.actor, input)),
  hours: read.input(MerchantOrgInput).output(StoreHoursView).query(({ ctx, input }) => ctx.stores.hours(ctx.actor, input)),
  setHours: edit.input(OpsSetHoursInput).output(StoreHoursView).mutation(({ ctx, input }) => ctx.stores.setHours(ctx.actor, input)),
  /** Open, close or pause: open orders stay as they are. A shop in setup opens only through `goLive`'s gate. */
  setOpen: edit.input(OpsSetOpenInput).output(StoreStatusView).mutation(({ ctx, input }) => ctx.stores.setOpen(ctx.actor, input)),
  setBusy: edit.input(OpsSetBusyInput).output(StoreStatusView).mutation(({ ctx, input }) => ctx.stores.setBusy(ctx.actor, input)),
  confirmKinds: edit.input(OpsSetupKindsInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.stores.confirmKinds(ctx.actor, input)),
  shopPhoto: edit.input(OpsShopPhotoInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.stores.shopPhoto(ctx.actor, input)),
  dishPhoto: edit.input(OpsDishPhotoInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.stores.dishPhoto(ctx.actor, input)),
  goLive: edit.input(OpsStoreInput).output(MerchantSetupView).mutation(({ ctx, input }) => ctx.stores.goLive(ctx.actor, input)),
});
