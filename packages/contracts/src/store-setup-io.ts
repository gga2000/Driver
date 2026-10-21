import { z } from 'zod';
import type { RoleKind } from './auth.js';
import type { Actor } from './identity-io.js';
import { MerchantOrgInput, SetBusyInput, SetStoreHoursInput, SetStoreOpenInput, type StoreHoursView, type StoreStatusView } from './merchant-io.js';
import { MerchantSetupView, SetupDishPhotoInput, SetupKindsInput, SetupShopPhotoInput } from './merchant-setup-io.js';
import type {
  AdminMenu,
  AdminMenuItem,
  MenuItemIdInput,
  MerchantScope,
  ReorderCategoriesInput,
  SetAvailabilityInput,
  SetModifiersInput,
  UpsertCategoryInput,
  UpsertItemInput,
} from './merchant-admin-io.js';

/**
 * Console › المطاعم (Ali, 2026-10-21): "our employees should be able to add the restaurant and their
 * items and images and set up everything for them". Driver's team does the owner's setup and menu work
 * for him from the Console, with the owner's own rules, every change written to the audit log under the
 * staff member's name, and the owner told in his app. Prices too, on a shop already open to customers
 * (Ali, 2026-10-21: "change now, tell the owner").
 */

/** Who sees every store's setup, menu and history in the Console. */
export const STORE_SETUP_READ_ROLES: readonly RoleKind[] = ['field_ops', 'admin', 'support'];
/** Who changes a store for its owner: field ops on the visit, and Ali. Support reads only. */
export const STORE_SETUP_EDIT_ROLES: readonly RoleKind[] = ['field_ops', 'admin'];

/** Where a store stands for customers: still being set up, open for orders, or closed by its owner or us. */
export const StoreSetupState = z.enum(['setup', 'live', 'closed']);
export type StoreSetupState = z.infer<typeof StoreSetupState>;

export const StoresInput = z.object({ cityId: z.string().min(1) });
export type StoresInput = z.infer<typeof StoresInput>;

/** One row of the stores list: how far its setup is, what is missing, and who changed it last. */
export const StoreRow = z.object({
  merchantOrgId: z.string(),
  name: z.string(),
  type: z.enum(['restaurant', 'grocer']),
  photoUrl: z.string().nullable(),
  state: StoreSetupState,
  /** «جهّز محلك»'s seven steps: done count and the next one (null when all are done). */
  steps: z.object({ done: z.number().int(), total: z.number().int(), next: z.string().nullable() }),
  dishes: z.number().int(),
  /** Dishes on sale without any photo (their own or the library's). */
  dishesNoPhoto: z.number().int(),
  lastEdit: z.object({ at: z.coerce.date(), actorName: z.string().nullable() }).nullable(),
});
export type StoreRow = z.infer<typeof StoreRow>;

export const StoreHistoryInput = z.object({ merchantOrgId: z.string().min(1), limit: z.number().int().min(1).max(200).default(50) });
export type StoreHistoryInput = z.input<typeof StoreHistoryInput>;

/** «السجل»: one change to the store, newest first. */
export const StoreHistoryEntry = z.object({
  id: z.string(),
  at: z.coerce.date(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  summaryAr: z.string(),
});
export type StoreHistoryEntry = z.infer<typeof StoreHistoryEntry>;

/**
 * «فريقنا عدّل بمحلك»: one change Driver's team made to the store, as its owner sees it in the
 * merchant app — what changed and the team member's first name (never his phone or full name).
 */
export const StaffChange = z.object({
  id: z.string(),
  at: z.coerce.date(),
  byFirstName: z.string().nullable(),
  summaryAr: z.string(),
});
export type StaffChange = z.infer<typeof StaffChange>;

/** A library photo's file: `lib-<slug>-<n>.webp`, served by the API at `/media/food/<file>`. */
export const LIBRARY_PHOTO_FILE = /^lib-([a-z]+(?:-[a-z]+)*)-(\d+)\.webp$/;

/** «من صورنا»: one of Driver's library photos as the dish's «صورة توضيحية» (no upload, no review). */
export const LibraryPhotoInput = z.object({
  merchantOrgId: z.string().min(1),
  itemId: z.string().min(1),
  photo: z.string().regex(LIBRARY_PHOTO_FILE),
});
export type LibraryPhotoInput = z.infer<typeof LibraryPhotoInput>;

/** «الصق المنيو»: rows read from a pasted list (a line per dish and its price), added in one go. */
export const AddItemsInput = z.object({
  merchantOrgId: z.string().min(1),
  categoryAr: z.string().trim().min(1).max(40).nullable().optional(),
  items: z
    .array(z.object({ nameAr: z.string().trim().min(1).max(80), priceIqd: z.number().int().positive().max(10_000_000) }))
    .min(1)
    .max(100),
});
export type AddItemsInput = z.infer<typeof AddItemsInput>;

/**
 * Why the team changed the store (optional, «ليش؟»): kept on the audit row and shown in the owner's
 * «فريقنا عدّل بمحلك» card. Named `why` because the owner's close already has a `reason`.
 */
export const StoreWhy = z.object({ why: z.string().trim().max(200).optional() });

/** The owner's own inputs, plus the team's «ليش؟». */
export const OpsStoreInput = MerchantOrgInput.and(StoreWhy);
export type OpsStoreInput = z.infer<typeof OpsStoreInput>;
export const OpsSetHoursInput = SetStoreHoursInput.and(StoreWhy);
export type OpsSetHoursInput = z.infer<typeof OpsSetHoursInput>;
export const OpsSetOpenInput = SetStoreOpenInput.and(StoreWhy);
export type OpsSetOpenInput = z.infer<typeof OpsSetOpenInput>;
export const OpsSetBusyInput = SetBusyInput.and(StoreWhy);
export type OpsSetBusyInput = z.infer<typeof OpsSetBusyInput>;
export const OpsSetupKindsInput = SetupKindsInput.and(StoreWhy);
export type OpsSetupKindsInput = z.infer<typeof OpsSetupKindsInput>;
/** A photo the team member uploaded himself (`account.photoUpload`). */
export const OpsShopPhotoInput = SetupShopPhotoInput.and(StoreWhy);
export type OpsShopPhotoInput = z.infer<typeof OpsShopPhotoInput>;
export const OpsDishPhotoInput = SetupDishPhotoInput.and(StoreWhy);
export type OpsDishPhotoInput = z.infer<typeof OpsDishPhotoInput>;

/** `ops.stores.*` as the API implements it (`modules/merchant-admin`, `StoresConsoleService`). */
export interface StoresOpsPort {
  list(actor: Actor, input: StoresInput): Promise<StoreRow[]>;
  history(actor: Actor, input: StoreHistoryInput): Promise<StoreHistoryEntry[]>;
  menu(actor: Actor, input: MerchantScope): Promise<AdminMenu>;
  upsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem>;
  addItems(actor: Actor, input: AddItemsInput): Promise<AdminMenu>;
  upsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu>;
  reorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu>;
  setModifiers(actor: Actor, input: z.output<typeof SetModifiersInput>): Promise<AdminMenuItem>;
  setAvailability(actor: Actor, input: z.infer<typeof SetAvailabilityInput>): Promise<AdminMenuItem>;
  soldOutToday(actor: Actor, input: z.infer<typeof MenuItemIdInput>): Promise<AdminMenuItem>;
  libraryPhoto(actor: Actor, input: LibraryPhotoInput): Promise<AdminMenuItem>;
  /** The shop's «جهّز محلك» as the owner sees it. */
  setup(actor: Actor, input: z.infer<typeof MerchantOrgInput>): Promise<MerchantSetupView>;
  status(actor: Actor, input: z.infer<typeof MerchantOrgInput>): Promise<StoreStatusView>;
  hours(actor: Actor, input: z.infer<typeof MerchantOrgInput>): Promise<StoreHoursView>;
  setHours(actor: Actor, input: OpsSetHoursInput): Promise<StoreHoursView>;
  setOpen(actor: Actor, input: OpsSetOpenInput): Promise<StoreStatusView>;
  setBusy(actor: Actor, input: OpsSetBusyInput): Promise<StoreStatusView>;
  confirmKinds(actor: Actor, input: OpsSetupKindsInput): Promise<MerchantSetupView>;
  shopPhoto(actor: Actor, input: OpsShopPhotoInput): Promise<MerchantSetupView>;
  dishPhoto(actor: Actor, input: OpsDishPhotoInput): Promise<MerchantSetupView>;
  /** «ارفع الكبنك» for the owner: the same gate (his practice order and sound check included). */
  goLive(actor: Actor, input: OpsStoreInput): Promise<MerchantSetupView>;
  /** `merchantAdmin.staffChanges`: the team's changes to his store, for its owner only (staff refused). */
  ownerChanges(actor: Actor, input: StoreHistoryInput): Promise<StaffChange[]>;
}
