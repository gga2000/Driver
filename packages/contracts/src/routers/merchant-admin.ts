import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AdminMenu,
  AdminMenuItem,
  ApplyImportInput,
  DealProjectionView,
  DealView,
  ImportFromPhotosInput,
  ImportJobInput,
  DaySummaryInput,
  InsightsInput,
  InviteStaffInput,
  MenuImportJob,
  MenuItemIdInput,
  MerchantCashAccount,
  MerchantDispute,
  MerchantDaySummary,
  MerchantInsights,
  MerchantScope,
  MoneyToday,
  MyMerchant,
  PriceChange,
  PriceUpdateOutput,
  ProposeDealInput,
  RemoveStaffInput,
  ResendStaffInviteInput,
  ReorderCategoriesInput,
  ReplacePhotoInput,
  RespondDisputeInput,
  ReviewDealInput,
  SetAvailabilityInput,
  SetDealActiveInput,
  SetModifiersInput,
  SetStaffRoleInput,
  StaffMember,
  StatementInput,
  UpdatePriceInput,
  UpsertCategoryInput,
  UpsertItemInput,
  WeeklyStatement,
} from '../merchant-admin-io.js';
import { DecideMenuShotInput, MenuPhotoRequestRef, MenuPhotoRequestView, RequestMenuPhotosInput } from '../menu-photos-io.js';
import { KitchenStoryView, MerchantPotView, SetKitchenStoryInput, SetPotInput } from '../habits-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** Coarse gate; the API checks the role is scoped to `merchantOrgId` and owner-only where noted. */
export const MERCHANT_ADMIN_ROLES: readonly RoleKind[] = ['merchant_owner', 'merchant_staff'];
/** Platform approval of merchant deals (city config switch). */
export const DEAL_REVIEWERS: readonly RoleKind[] = ['admin', 'support'];

const p = protectedProcedure(MERCHANT_ADMIN_ROLES);

/**
 * `merchantAdmin.*` — Merchant app wave 2: menu, deals, money, insights, staff. Owner-only:
 * `money.*`, `staff.*`, `deals.project` / `deals.propose` / `deals.setActive` (FORBIDDEN for staff).
 */
export const merchantAdminRouter = router({
  /** Merchants the caller works at, with his role at each. */
  myMerchants: p.output(z.array(MyMerchant)).query(({ ctx }) => ctx.merchantAdmin.myMerchants(ctx.actor)),
  menu: router({
    get: p.input(MerchantScope).output(AdminMenu).query(({ ctx, input }) => ctx.merchantAdmin.menuGet(ctx.actor, input)),
    setAvailability: p.input(SetAvailabilityInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.merchantAdmin.menuSetAvailability(ctx.actor, input)),
    /** "خلص اليوم": off sale until the next local midnight, then back by itself. */
    soldOutToday: p.input(MenuItemIdInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.merchantAdmin.menuSoldOutToday(ctx.actor, input)),
    updatePrice: p.input(UpdatePriceInput).output(PriceUpdateOutput).mutation(({ ctx, input }) => ctx.merchantAdmin.menuUpdatePrice(ctx.actor, input)),
    priceHistory: p.input(MenuItemIdInput).output(z.array(PriceChange)).query(({ ctx, input }) => ctx.merchantAdmin.menuPriceHistory(ctx.actor, input)),
    replacePhoto: p.input(ReplacePhotoInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.merchantAdmin.menuReplacePhoto(ctx.actor, input)),
    upsertItem: p.input(UpsertItemInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.merchantAdmin.menuUpsertItem(ctx.actor, input)),
    upsertCategory: p.input(UpsertCategoryInput).output(AdminMenu).mutation(({ ctx, input }) => ctx.merchantAdmin.menuUpsertCategory(ctx.actor, input)),
    /** Section order (items keep theirs inside each section). */
    reorderCategories: p.input(ReorderCategoriesInput).output(AdminMenu).mutation(({ ctx, input }) => ctx.merchantAdmin.menuReorderCategories(ctx.actor, input)),
    /** Replaces the item's modifier groups. */
    setModifiers: p.input(SetModifiersInput).output(AdminMenuItem).mutation(({ ctx, input }) => ctx.merchantAdmin.menuSetModifiers(ctx.actor, input)),
    importFromPhotos: p.input(ImportFromPhotosInput).output(MenuImportJob).mutation(({ ctx, input }) => ctx.merchantAdmin.menuImportFromPhotos(ctx.actor, input)),
    importJob: p.input(ImportJobInput).output(MenuImportJob).query(({ ctx, input }) => ctx.merchantAdmin.menuImportJob(ctx.actor, input)),
    applyImport: p.input(ApplyImportInput).output(MenuImportJob).mutation(({ ctx, input }) => ctx.merchantAdmin.menuApplyImport(ctx.actor, input)),
  }),
  /** «تصوير المنيو» (maps k3): ask field ops to photograph dishes; owner-only actions, staff read. */
  menuPhotos: router({
    list: p.input(MerchantScope).output(z.array(MenuPhotoRequestView)).query(({ ctx, input }) => ctx.menuPhotos.merchantList(ctx.actor, input)),
    request: p.input(RequestMenuPhotosInput).output(MenuPhotoRequestView).mutation(({ ctx, input }) => ctx.menuPhotos.request(ctx.actor, input)),
    cancel: p.input(MenuPhotoRequestRef).output(MenuPhotoRequestView).mutation(({ ctx, input }) => ctx.menuPhotos.cancel(ctx.actor, input)),
    /** Accept (becomes the dish's photo) or reject one photo from the visit. */
    decide: p.input(DecideMenuShotInput).output(MenuPhotoRequestView).mutation(({ ctx, input }) => ctx.menuPhotos.decide(ctx.actor, input)),
  }),
  deals: router({
    list: p.input(MerchantScope).output(z.array(DealView)).query(({ ctx, input }) => ctx.merchantAdmin.dealsList(ctx.actor, input)),
    /** Projected cost of a draft (owner, nothing stored): shown before the owner submits. */
    project: p.input(ProposeDealInput).output(DealProjectionView).query(({ ctx, input }) => ctx.merchantAdmin.dealsProject(ctx.actor, input)),
    propose: p.input(ProposeDealInput).output(DealView).mutation(({ ctx, input }) => ctx.merchantAdmin.dealsPropose(ctx.actor, input)),
    setActive: p.input(SetDealActiveInput).output(DealView).mutation(({ ctx, input }) => ctx.merchantAdmin.dealsSetActive(ctx.actor, input)),
    review: protectedProcedure(DEAL_REVIEWERS).input(ReviewDealInput).output(DealView).mutation(({ ctx, input }) => ctx.merchantAdmin.dealsReview(ctx.actor, input)),
  }),
  money: router({
    today: p.input(MerchantScope).output(MoneyToday).query(({ ctx, input }) => ctx.merchantAdmin.moneyToday(ctx.actor, input)),
    /** Cash account: balance, couriers holding it, the open "اطلب فلوسك" and its timeline, recent hand-overs. */
    cash: p.input(MerchantScope).output(MerchantCashAccount).query(({ ctx, input }) => ctx.merchantAdmin.moneyCash(ctx.actor, input)),
    statement: p.input(StatementInput).output(WeeklyStatement).query(({ ctx, input }) => ctx.merchantAdmin.moneyStatement(ctx.actor, input)),
    disputes: p.input(MerchantScope).output(z.array(MerchantDispute)).query(({ ctx, input }) => ctx.merchantAdmin.moneyDisputes(ctx.actor, input)),
    respondDispute: p.input(RespondDisputeInput).output(MerchantDispute).mutation(({ ctx, input }) => ctx.merchantAdmin.moneyRespondDispute(ctx.actor, input)),
  }),
  insights: p.input(InsightsInput).output(MerchantInsights).query(({ ctx, input }) => ctx.merchantAdmin.insights(ctx.actor, input)),
  /** S-M6: the day's summary card (at close, or from 00:30 for the day before); owner and staff. */
  daySummary: p.input(DaySummaryInput).output(MerchantDaySummary).query(({ ctx, input }) => ctx.merchantAdmin.daySummary(ctx.actor, input)),
  staff: router({
    list: p.input(MerchantScope).output(z.array(StaffMember)).query(({ ctx, input }) => ctx.merchantAdmin.staffList(ctx.actor, input)),
    invite: p.input(InviteStaffInput).output(StaffMember).mutation(({ ctx, input }) => ctx.merchantAdmin.staffInvite(ctx.actor, input)),
    setRole: p.input(SetStaffRoleInput).output(StaffMember).mutation(({ ctx, input }) => ctx.merchantAdmin.staffSetRole(ctx.actor, input)),
    remove: p.input(RemoveStaffInput).output(z.object({ removed: z.boolean() })).mutation(({ ctx, input }) => ctx.merchantAdmin.staffRemove(ctx.actor, input)),
    /** A pending invite goes out again (owner only; once per 10 min; the row after). */
    resendInvite: p.input(ResendStaffInviteInput).output(StaffMember).mutation(({ ctx, input }) => ctx.merchantAdmin.staffResendInvite(ctx.actor, input)),
  }),
  /** «قدر اليوم» (joy h2): one dish a day, posted in one tap; followers get one push. Owner and staff. */
  pot: router({
    get: p.input(MerchantScope).output(MerchantPotView).query(({ ctx, input }) => ctx.merchantAdmin.potGet(ctx.actor, input)),
    set: p.input(SetPotInput).output(MerchantPotView).mutation(({ ctx, input }) => ctx.merchantAdmin.potSet(ctx.actor, input)),
    clear: p.input(MerchantScope).output(MerchantPotView).mutation(({ ctx, input }) => ctx.merchantAdmin.potClear(ctx.actor, input)),
  }),
  /** «مطاعمنا» (joy h5): the owner's lines and the year; shown to customers only when he says so (owner writes). */
  story: router({
    get: p.input(MerchantScope).output(KitchenStoryView).query(({ ctx, input }) => ctx.merchantAdmin.storyGet(ctx.actor, input)),
    set: p.input(SetKitchenStoryInput).output(KitchenStoryView).mutation(({ ctx, input }) => ctx.merchantAdmin.storySet(ctx.actor, input)),
  }),
});
