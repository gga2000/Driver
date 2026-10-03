import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { CommissionTier, SettlementMode } from './ledger-rules.js';
import { DisputeKind, PaymentMethod } from './order.js';

/**
 * `merchantAdmin.*` — the Merchant app's second wave (partner & merchant apps spec): menu, deals,
 * money, insights and staff. Every call names the merchant org; the caller must hold
 * `merchant_owner` or `merchant_staff` scoped to it. Owner-only: money, staff and changing deals
 * ("roles gate money views"). Menu edits go through the catalog module; deals through the
 * promotions module (discounts reach an order only via `PromotionsPort`); money from the ledger.
 */

export const MerchantScope = z.object({ merchantOrgId: z.string().min(1) });
export type MerchantScope = z.infer<typeof MerchantScope>;

export const MerchantStaffRole = z.enum(['merchant_owner', 'merchant_staff']);
export type MerchantStaffRole = z.infer<typeof MerchantStaffRole>;

export const MyMerchant = z.object({ merchantOrgId: z.string(), role: MerchantStaffRole });

// ───────────────────────── menu ─────────────────────────

export const AdminModifier = z.object({ id: z.string(), nameAr: z.string(), nameEn: z.string().nullable(), priceIqd: Iqd, available: z.boolean() });
export const AdminModifierGroup = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  required: z.boolean(),
  modifiers: z.array(AdminModifier),
});

export const AdminMenuItem = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  description: z.string().nullable(),
  priceIqd: Iqd,
  photoUrl: z.string().nullable(),
  categoryAr: z.string().nullable(),
  sortOrder: z.number().int(),
  prepTimeMin: z.number().int(),
  /** The merchant's own toggle. */
  available: z.boolean(),
  /** "خلص اليوم": back on sale at the next local midnight. */
  soldOutUntil: z.coerce.date().nullable(),
  /** What customers see right now (toggle, sold-out-today, stock). */
  onSale: z.boolean(),
  modifierGroups: z.array(AdminModifierGroup),
});
export type AdminMenuItem = z.infer<typeof AdminMenuItem>;

export const AdminMenu = z.object({
  merchantOrgId: z.string(),
  categories: z.array(z.object({ nameAr: z.string().nullable(), items: z.array(AdminMenuItem) })),
});
export type AdminMenu = z.infer<typeof AdminMenu>;

export const MenuItemIdInput = MerchantScope.extend({ itemId: z.string().min(1) });
export const SetAvailabilityInput = MenuItemIdInput.extend({ available: z.boolean() });
export const UpdatePriceInput = MenuItemIdInput.extend({ priceIqd: Iqd.positive().max(10_000_000) });
export const ReplacePhotoInput = MenuItemIdInput.extend({ uploadId: z.string().min(1) });

export const PriceChange = z.object({ oldPriceIqd: Iqd, newPriceIqd: Iqd, changedBy: z.string(), at: z.coerce.date() });
export type PriceChange = z.infer<typeof PriceChange>;
export const PriceUpdateOutput = z.object({ item: AdminMenuItem, history: z.array(PriceChange) });

export const UpsertItemInput = MerchantScope.extend({
  /** Absent = new item. */
  itemId: z.string().min(1).optional(),
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  priceIqd: Iqd.positive().max(10_000_000),
  categoryAr: z.string().trim().min(1).max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  prepTimeMin: z.number().int().min(1).max(240).optional(),
  available: z.boolean().optional(),
});
export type UpsertItemInput = z.infer<typeof UpsertItemInput>;

/** Categories are the items' section names: rename moves every item; `sortOrder` orders sections. */
export const UpsertCategoryInput = MerchantScope.extend({
  nameAr: z.string().trim().min(1).max(40),
  renameFrom: z.string().trim().min(1).max(40).optional(),
  /** Item ids to place in this section, in order (others keep theirs). */
  itemIds: z.array(z.string().min(1)).max(200).optional(),
});
export type UpsertCategoryInput = z.infer<typeof UpsertCategoryInput>;

/**
 * Section order as the customer menu shows it: names in this order first, any section not named keeps
 * its place after them, the unnamed section stays last. Items keep their order inside each section.
 */
export const ReorderCategoriesInput = MerchantScope.extend({ order: z.array(z.string().trim().min(1).max(40)).min(1).max(50) });
export type ReorderCategoriesInput = z.infer<typeof ReorderCategoriesInput>;

export const SetModifiersInput = MenuItemIdInput.extend({
  groups: z
    .array(
      z.object({
        nameAr: z.string().trim().min(1).max(60),
        nameEn: z.string().trim().max(60).nullable().optional(),
        minSelect: z.number().int().min(0).max(20).default(0),
        maxSelect: z.number().int().min(1).max(20).default(1),
        required: z.boolean().default(false),
        modifiers: z
          .array(z.object({ nameAr: z.string().trim().min(1).max(60), nameEn: z.string().trim().max(60).nullable().optional(), priceIqd: Iqd.min(0).max(1_000_000), available: z.boolean().default(true) }))
          .min(1)
          .max(30),
      }),
    )
    .max(10),
});
export type SetModifiersInput = z.input<typeof SetModifiersInput>;

export const ImportedItem = z.object({
  nameAr: z.string().trim().min(1).max(80),
  priceIqd: Iqd.positive().max(10_000_000),
  categoryAr: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  /** Which uploaded photo it was read from. */
  sourceUploadId: z.string().nullable().optional(),
});
export type ImportedItem = z.infer<typeof ImportedItem>;

export const MenuImportJob = z.object({
  jobId: z.string(),
  merchantOrgId: z.string(),
  state: z.enum(['draft', 'applied', 'discarded']),
  photoUploadIds: z.array(z.string()),
  /** Signed read URLs of those photos, same order (staff correct the rows while looking at them). */
  photoUrls: z.array(z.string()),
  /** OCR is stubbed: the draft starts empty and staff type the items while looking at the photos. */
  items: z.array(ImportedItem),
  ocr: z.enum(['stub', 'done']),
  createdAt: z.coerce.date(),
  appliedAt: z.coerce.date().nullable(),
  appliedCount: z.number().int(),
});
export type MenuImportJob = z.infer<typeof MenuImportJob>;

export const ImportFromPhotosInput = MerchantScope.extend({ uploadIds: z.array(z.string().min(1)).min(1).max(30) });
export const ImportJobInput = MerchantScope.extend({ jobId: z.string().min(1) });
/** Staff-corrected rows; applying creates the items (prices get a first history row). */
export const ApplyImportInput = ImportJobInput.extend({ items: z.array(ImportedItem).min(1).max(300) });

// ───────────────────────── deals ─────────────────────────

export const DealType = z.enum(['percent', 'fixed', 'free_delivery', 'bogo']);
export type DealType = z.infer<typeof DealType>;

export const DealSchedule = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  /** Local days 0 = Sunday … 6 = Saturday; empty = every day. */
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Local "HH:MM" window; absent = all opening hours. */
  hours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),
});
export type DealSchedule = z.infer<typeof DealSchedule>;

export const ProposeDealInput = MerchantScope.extend({
  type: DealType,
  /** Percent 1–50 for `percent`; IQD for `fixed` (multiples of 250); ignored otherwise. */
  value: z.number().int().min(0).max(1_000_000).default(0),
  nameAr: z.string().trim().min(2).max(60),
  /** Items the deal covers; empty = whole menu (bogo needs at least one). */
  itemIds: z.array(z.string().min(1)).max(50).default([]),
  schedule: DealSchedule,
  /** Auto-stop when the merchant has funded this much (money §5). */
  budgetCapIqd: Iqd.positive().optional(),
  minOrderIqd: Iqd.min(0).default(0),
});
export type ProposeDealInput = z.input<typeof ProposeDealInput>;

/** Server-computed from the last 28 days of orders: what the deal is expected to cost the merchant. */
export const DealProjection = z.object({ ordersPerWeek: z.number(), costPerOrderIqd: Iqd, weeklyCostIqd: Iqd, totalCostIqd: Iqd, basisOrders: z.number().int() });
export type DealProjection = z.infer<typeof DealProjection>;

/** `deals.project`: the projection of a draft before the owner submits it (nothing is stored). */
export const DealProjectionView = z.object({
  projected: DealProjection,
  /** Days of order history the projection read. */
  basisDays: z.number().int(),
  /** The city's switch: the deal waits for platform approval once proposed. */
  requiresApproval: z.boolean(),
});
export type DealProjectionView = z.infer<typeof DealProjectionView>;

export const DealState = z.enum(['pending_approval', 'approved', 'rejected', 'paused', 'ended']);
export type DealState = z.infer<typeof DealState>;

export const DealView = z.object({
  dealId: z.string(),
  merchantOrgId: z.string(),
  nameAr: z.string(),
  type: DealType,
  value: z.number().int(),
  itemIds: z.array(z.string()),
  schedule: DealSchedule,
  minOrderIqd: Iqd,
  budgetCapIqd: Iqd.nullable(),
  spentIqd: Iqd,
  /** Server-computed from the last 28 days of orders: what the deal is expected to cost the merchant. */
  projected: DealProjection,
  state: DealState,
  state_ar: z.string(),
  active: z.boolean(),
  /** Deducted from the merchant's payouts (money §5); the customer sees it as its own line. */
  funder: z.literal('merchant'),
  createdAt: z.coerce.date(),
});
export type DealView = z.infer<typeof DealView>;

export const DealIdInput = MerchantScope.extend({ dealId: z.string().min(1) });
export const SetDealActiveInput = DealIdInput.extend({ active: z.boolean() });
/** Platform approval switch (city config `merchantDeals.requirePlatformApproval`): admin / support. */
export const ReviewDealInput = z.object({ dealId: z.string().min(1), approve: z.boolean(), reason: z.string().trim().max(200).optional() });

// ───────────────────────── money ─────────────────────────

export const CommissionByTier = z.object({ tier: CommissionTier, pct: z.number(), baseIqd: Iqd, commissionIqd: Iqd, orders: z.number().int() });

export const MoneyToday = z.object({
  merchantOrgId: z.string(),
  /** Baghdad local date (YYYY-MM-DD). */
  localDate: z.string(),
  orders: z.number().int(),
  /** Item sales (commission base) of today's delivered/closed orders. */
  salesIqd: Iqd,
  commissionIqd: Iqd,
  commissionByTier: z.array(CommissionByTier),
  /** Merchant-funded deal discounts today. */
  dealsIqd: Iqd,
  netIqd: Iqd,
  /** Couriers holding this merchant's cash right now (decisions §3). */
  cashHeldByCouriersIqd: Iqd,
  holders: z.array(z.object({ courierId: z.string(), amountIqd: Iqd })),
  /** Live `merchant_payable` balance: + owed to the merchant, − the merchant owes commission. */
  payableBalanceIqd: Iqd,
  settlementMode: SettlementMode,
  overExposure: z.boolean(),
});
export type MoneyToday = z.infer<typeof MoneyToday>;

export const StatementInput = MerchantScope.extend({
  /** Any instant in the wanted week (Sunday-start, Baghdad); default this week. */
  weekOf: z.coerce.date().optional(),
});

export const StatementOrderLine = z.object({
  orderId: z.string(),
  at: z.coerce.date(),
  payment: PaymentMethod,
  itemsIqd: Iqd,
  commissionTier: CommissionTier.nullable(),
  commissionIqd: Iqd,
  /** Courier-waiting / cancellation fees paid to the merchant on this order. */
  feesIqd: Iqd,
  netIqd: Iqd,
});
export type StatementOrderLine = z.infer<typeof StatementOrderLine>;

export const WeeklyStatement = z.object({
  merchantOrgId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  openingIqd: Iqd,
  closingIqd: Iqd,
  lines: z.array(StatementOrderLine),
  /** Hand-overs from couriers and company payouts in the week. */
  settlements: z.array(z.object({ at: z.coerce.date(), kind: z.enum(['courier_handover', 'payout']), amountIqd: Iqd, reference: z.string().nullable() })),
  totals: z.object({ orders: z.number().int(), itemsIqd: Iqd, commissionIqd: Iqd, feesIqd: Iqd, netIqd: Iqd, settledIqd: Iqd }),
});
export type WeeklyStatement = z.infer<typeof WeeklyStatement>;

export const DisputeOutcome = z.object({
  /** Domain §9 table: what happens unless support overrides. */
  code: z.enum(['delivery_fee_credit', 'merchant_refunds_item', 'merchant_redelivers', 'courier_liable', 'support_review']),
  text_ar: z.string(),
  /** What the default costs the merchant (0 when someone else carries it). */
  merchantImpactIqd: Iqd,
});

export const MerchantDispute = z.object({
  orderId: z.string(),
  kind: DisputeKind,
  note: z.string().nullable(),
  openedAt: z.coerce.date(),
  evidence: z.object({
    acceptedAt: z.coerce.date().nullable(),
    readyAt: z.coerce.date().nullable(),
    pickedUpAt: z.coerce.date().nullable(),
    deliveredAt: z.coerce.date().nullable(),
    promisedReadyAt: z.coerce.date().nullable(),
    /** Items grouped by person as the merchant packed them. */
    lines: z.array(z.object({ name: z.string(), qty: z.number().int(), participant: z.string().nullable() })),
    itemsIqd: Iqd,
  }),
  defaultOutcome: DisputeOutcome,
  response: z.object({ decision: z.enum(['accept_default', 'contest']), note: z.string().nullable(), evidencePhotos: z.number().int(), at: z.coerce.date() }).nullable(),
});
export type MerchantDispute = z.infer<typeof MerchantDispute>;

export const RespondDisputeInput = MerchantScope.extend({
  orderId: z.string().min(1),
  decision: z.enum(['accept_default', 'contest']),
  note: z.string().trim().max(500).optional(),
  evidenceUploadIds: z.array(z.string().min(1)).max(5).default([]),
});
export type RespondDisputeInput = z.input<typeof RespondDisputeInput>;

// ───────────────────────── insights ─────────────────────────

export const InsightsInput = MerchantScope.extend({ days: z.number().int().min(1).max(90).default(30) });
export const MerchantInsights = z.object({
  merchantOrgId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Quoted (promised) vs actual prep from accept to "جاهز". */
  prepHonesty: z.object({ samples: z.number().int(), quotedAvgMin: z.number().nullable(), actualAvgMin: z.number().nullable(), onTimeShare: z.number().nullable() }),
  rejection: z.object({ offered: z.number().int(), rejected: z.number().int(), rate: z.number().nullable() }),
  itemRatings: z.array(
    z.object({ itemId: z.string(), nameAr: z.string().nullable(), avg: z.number(), count: z.number().int(), reviews: z.array(z.object({ score: z.number().int(), note: z.string(), at: z.coerce.date() })) }),
  ),
  /** Orders placed per Baghdad local hour 0–23. */
  peakHours: z.array(z.number().int()).length(24),
});
export type MerchantInsights = z.infer<typeof MerchantInsights>;

// ───────────────────────── staff ─────────────────────────

export const StaffMember = z.object({
  personId: z.string(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  role: MerchantStaffRole,
  you: z.boolean(),
});
export type StaffMember = z.infer<typeof StaffMember>;

export const InviteStaffInput = MerchantScope.extend({ phone: z.string().min(7).max(20), role: MerchantStaffRole.default('merchant_staff') });
export const SetStaffRoleInput = MerchantScope.extend({ personId: z.string().min(1), role: MerchantStaffRole });
export const RemoveStaffInput = MerchantScope.extend({ personId: z.string().min(1) });

export interface MerchantAdminPort {
  myMerchants(actor: Actor): Promise<Array<z.infer<typeof MyMerchant>>>;
  menuGet(actor: Actor, input: MerchantScope): Promise<AdminMenu>;
  menuSetAvailability(actor: Actor, input: z.infer<typeof SetAvailabilityInput>): Promise<AdminMenuItem>;
  menuSoldOutToday(actor: Actor, input: z.infer<typeof MenuItemIdInput>): Promise<AdminMenuItem>;
  menuUpdatePrice(actor: Actor, input: z.infer<typeof UpdatePriceInput>): Promise<z.infer<typeof PriceUpdateOutput>>;
  menuPriceHistory(actor: Actor, input: z.infer<typeof MenuItemIdInput>): Promise<PriceChange[]>;
  menuReplacePhoto(actor: Actor, input: z.infer<typeof ReplacePhotoInput>): Promise<AdminMenuItem>;
  menuUpsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem>;
  menuUpsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu>;
  menuReorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu>;
  menuSetModifiers(actor: Actor, input: z.output<typeof SetModifiersInput>): Promise<AdminMenuItem>;
  menuImportFromPhotos(actor: Actor, input: z.infer<typeof ImportFromPhotosInput>): Promise<MenuImportJob>;
  menuImportJob(actor: Actor, input: z.infer<typeof ImportJobInput>): Promise<MenuImportJob>;
  menuApplyImport(actor: Actor, input: z.infer<typeof ApplyImportInput>): Promise<MenuImportJob>;
  dealsList(actor: Actor, input: MerchantScope): Promise<DealView[]>;
  dealsProject(actor: Actor, input: z.output<typeof ProposeDealInput>): Promise<DealProjectionView>;
  dealsPropose(actor: Actor, input: z.output<typeof ProposeDealInput>): Promise<DealView>;
  dealsSetActive(actor: Actor, input: z.infer<typeof SetDealActiveInput>): Promise<DealView>;
  dealsReview(actor: Actor, input: z.infer<typeof ReviewDealInput>): Promise<DealView>;
  moneyToday(actor: Actor, input: MerchantScope): Promise<MoneyToday>;
  moneyStatement(actor: Actor, input: z.infer<typeof StatementInput>): Promise<WeeklyStatement>;
  moneyDisputes(actor: Actor, input: MerchantScope): Promise<MerchantDispute[]>;
  moneyRespondDispute(actor: Actor, input: z.output<typeof RespondDisputeInput>): Promise<MerchantDispute>;
  insights(actor: Actor, input: z.output<typeof InsightsInput>): Promise<MerchantInsights>;
  staffList(actor: Actor, input: MerchantScope): Promise<StaffMember[]>;
  staffInvite(actor: Actor, input: z.output<typeof InviteStaffInput>): Promise<StaffMember>;
  staffSetRole(actor: Actor, input: z.infer<typeof SetStaffRoleInput>): Promise<StaffMember>;
  staffRemove(actor: Actor, input: z.infer<typeof RemoveStaffInput>): Promise<{ removed: boolean }>;
}
