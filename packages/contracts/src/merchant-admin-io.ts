import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { SettlementRequestReason } from './ledger-io.js';
import { CommissionTier, SettlementMode } from './ledger-rules.js';
import { DisputeKind, PaymentMethod } from './order.js';
import { DealType } from './deals.js';
import { DISH_LABELS, DishLabel } from './catalog-io.js';
import type { KitchenStoryView, MerchantPotView, SetKitchenStoryInput, SetPotInput } from './habits-io.js';

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

export const AdminModifier = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  priceIqd: Iqd,
  available: z.boolean(),
  /** «يشبّع» for this version (joy o3); null = not said. */
  servesMin: z.number().int().nullable().optional(),
  servesMax: z.number().int().nullable().optional(),
});
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
  /** «يشبّع» for the dish as it comes (joy o3); null = not said. */
  servesMin: z.number().int().nullable().optional(),
  servesMax: z.number().int().nullable().optional(),
  /** The kitchen's dish labels (joy o8). */
  labels: z.array(DishLabel).optional(),
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
  /** «يشبّع 2–3» for the dish as it comes (joy o3); null clears it. */
  servesMin: z.number().int().min(1).max(50).nullable().optional(),
  servesMax: z.number().int().min(1).max(50).nullable().optional(),
  /** The kitchen's dish labels (joy o8). */
  labels: z.array(DishLabel).max(DISH_LABELS.length).optional(),
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
          .array(
            z.object({
              nameAr: z.string().trim().min(1).max(60),
              nameEn: z.string().trim().max(60).nullable().optional(),
              priceIqd: Iqd.min(0).max(1_000_000),
              available: z.boolean().default(true),
              /** «يشبّع» for this version (joy o3): both or neither, min ≤ max. */
              servesMin: z.number().int().min(1).max(50).nullable().optional(),
              servesMax: z.number().int().min(1).max(50).nullable().optional(),
            }),
          )
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
  /** Today's delivered/closed orders: the ones `salesIqd` is made of (not the kitchen's open orders). */
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

/** "اطلب فلوسك" as it moves: requested → courier on the way → handed over (PIN or tablet tap). */
export const SettlementRequestState = z.enum(['requested', 'on_the_way', 'handed_over']);
export type SettlementRequestState = z.infer<typeof SettlementRequestState>;

export const HandoverConfirmation = z.enum(['pin', 'tablet']);
export type HandoverConfirmation = z.infer<typeof HandoverConfirmation>;

export const CashHandover = z.object({
  /** Also the receipt number printed on the WhatsApp receipt. */
  handoverId: z.string(),
  at: z.coerce.date(),
  courierId: z.string(),
  courierName: z.string().nullable(),
  amountIqd: Iqd,
  /** The merchant's balance right after this hand-over. */
  balanceAfterIqd: Iqd,
  confirmedBy: HandoverConfirmation.nullable(),
});
export type CashHandover = z.infer<typeof CashHandover>;

export const SettlementRequestView = z.object({
  reference: z.string(),
  reason: SettlementRequestReason,
  requestedAt: z.coerce.date(),
  /** Balance when asked. */
  amountIqd: Iqd,
  state: SettlementRequestState,
  channel: z.enum(['courier', 'ops_round', 'zaincash', 'bank']).nullable(),
  courierId: z.string().nullable(),
  courierName: z.string().nullable(),
  assignedAt: z.coerce.date().nullable(),
  /** Decisions §3: within the hour. */
  targetBy: z.coerce.date().nullable(),
  handover: CashHandover.nullable(),
});
export type SettlementRequestView = z.infer<typeof SettlementRequestView>;

/**
 * S-M5 · the money pill in one line (UI/UX audit merchant-and-console §8, M-07), worked out on the
 * server so the header never guesses: `owed` — Driver holds this for him and `arrives` says how it
 * reaches him ("توصلك الليلة ويا الدليفري"); `owe` — commission left on him, taken off his next money;
 * `requested` — he asked and `by` is the promised time ("فلوسك جاية قبل 9:40 م"); `zero` — nothing.
 */
export const MoneyHeadline = z.object({
  kind: z.enum(['owed', 'owe', 'zero', 'requested']),
  /** owed / requested: what Driver holds for him; owe: the commission left on him; zero: 0. */
  amountIqd: Iqd,
  /** owed: how the money reaches him (from his settlement mode); null otherwise. */
  arrives: z.enum(['tonight_courier', 'on_request', 'zaincash_daily', 'bank_weekly']).nullable(),
  /** requested: the promised time once a courier or channel is set; null until then. */
  by: z.coerce.date().nullable(),
});
export type MoneyHeadline = z.infer<typeof MoneyHeadline>;

/** The merchant cash account (decisions §3) for the Money screen: balance, who holds it, the open request, hand-overs. */
export const MerchantCashAccount = z.object({
  merchantOrgId: z.string(),
  /** Live `merchant_payable`: + owed to the merchant. */
  balanceIqd: Iqd,
  exposureCapIqd: Iqd,
  overExposure: z.boolean(),
  mode: SettlementMode,
  /** Couriers holding this merchant's cash now, largest first, with first names (vault read, logged). */
  holders: z.array(z.object({ courierId: z.string(), name: z.string().nullable(), amountIqd: Iqd })),
  /** The rest of the balance: prepaid orders and anything else Driver itself owes. */
  heldByPlatformIqd: Iqd,
  /** Latest "اطلب فلوسك" (merchant or exposure cap) within the last day; null when none. */
  request: SettlementRequestView.nullable(),
  /** Recent courier hand-overs, newest first (14 days, at most 20). */
  handovers: z.array(CashHandover),
  lastSettledAt: z.coerce.date().nullable(),
  /** S-M5: the header pill in one line (server-computed). */
  headline: MoneyHeadline.optional(),
});
export type MerchantCashAccount = z.infer<typeof MerchantCashAccount>;

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
  /** The tier's rate in percent (12, 15, 18, 5); null when no commission was charged. */
  commissionPct: z.number().nullable().default(null),
  commissionIqd: Iqd,
  /** Discount the customer got on this order (G-87: platform-funded today, so it does not lower the merchant's net). */
  discountIqd: Iqd.default(0),
  /** Who funded `discountIqd`: merchant deals come off the net, platform promos don't. */
  discountFunder: z.enum(['platform', 'merchant']).nullable().default(null),
  /** The deal's exact saving as promised (20 % → 3,000); `discountIqd` is that less `roundingIqd` (0 when unrounded or unknown). */
  dealIqd: Iqd.default(0),
  /** Rounding the customer's total up to the step gave this back to the funder ("تقريب"); `discountIqd = dealIqd − roundingIqd`. */
  roundingIqd: Iqd.default(0),
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
  totals: z.object({
    orders: z.number().int(),
    itemsIqd: Iqd,
    commissionIqd: Iqd,
    feesIqd: Iqd,
    netIqd: Iqd,
    settledIqd: Iqd,
    /**
     * M-17 bridge: everything else that moved the account in the week (corrections, payouts not tied to
     * an order…), so `opening + net − settled + adjustments = closing` always holds on screen.
     */
    adjustmentsIqd: Iqd.default(0),
  }),
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
    /** Signed URLs of photos attached when the dispute was opened (customer / courier), when any. */
    photos: z.array(z.string()).default([]),
  }),
  defaultOutcome: DisputeOutcome,
  /** After this the default outcome applies without the merchant's answer (48 h from opening). */
  respondBy: z.coerce.date().nullable().default(null),
  response: z
    .object({
      decision: z.enum(['accept_default', 'contest']),
      note: z.string().nullable(),
      evidencePhotos: z.number().int(),
      /** Signed read URLs of the merchant's evidence photos (expire within the hour). */
      photoUrls: z.array(z.string()).default([]),
      at: z.coerce.date(),
    })
    .nullable(),
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
  rejection: z.object({
    offered: z.number().int(),
    rejected: z.number().int(),
    rate: z.number().nullable(),
    /** 7-day buckets, oldest first, the last one ending at `to`. */
    trend: z.array(z.object({ from: z.coerce.date(), to: z.coerce.date(), offered: z.number().int(), rejected: z.number().int(), rate: z.number().nullable() })).default([]),
  }),
  itemRatings: z.array(
    z.object({ itemId: z.string(), nameAr: z.string().nullable(), avg: z.number(), count: z.number().int(), reviews: z.array(z.object({ score: z.number().int(), note: z.string(), at: z.coerce.date() })) }),
  ),
  /** Orders placed per Baghdad local hour 0–23. */
  peakHours: z.array(z.number().int()).length(24),
  /** Orders placed per local weekday (0 = Sunday) × hour: the peak-hours heatmap. */
  peakGrid: z.array(z.array(z.number().int()).length(24)).default([]),
  /** Best-selling items of accepted orders, by sales (quantity alongside). */
  /** `salesIqd` is the owner's (money views are owner-only): null for staff, who get the list by quantity. */
  bestSellers: z.array(z.object({ itemId: z.string(), nameAr: z.string().nullable(), qty: z.number().int(), orders: z.number().int(), salesIqd: Iqd.nullable() })).default([]),
  /** Orders placed in the window (any outcome). */
  orders: z.number().int().default(0),
});
export type MerchantInsights = z.infer<typeof MerchantInsights>;

// ───────────────────────── end of day (S-M6) ─────────────────────────

/** `date` = a Baghdad local day (YYYY-MM-DD); default: the day the card is about now (see `due`). */
export const DaySummaryInput = MerchantScope.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export type DaySummaryInput = z.input<typeof DaySummaryInput>;

/** The one thing to do tomorrow, from the day's own numbers (Insights' verdicts). */
export const DayAdviceKind = z.enum(['missed', 'prep_late', 'prep_uneven', 'prep_early', 'rejected', 'honest']);
export type DayAdviceKind = z.infer<typeof DayAdviceKind>;

/**
 * S-M6 · the end-of-day card (UI/UX audit merchant-and-console §8): "اليوم: 42 طلب · فاتك 0 · وقتك
 * مضبوط 91% · الصافي 512,000 دينار" and one advice line. Computed on the server for a Baghdad local
 * day. `due` says whether the board shows it now: the store closed for the day (`closed`), or the
 * day ended (`day_end`, from 00:30 to 05:00 for the day before). `netIqd` is the owner's: null for
 * staff, and while none of the day's orders has been delivered yet (an order's money is booked at
 * delivery).
 */
export const MerchantDaySummary = z.object({
  merchantOrgId: z.string(),
  storeName: z.string(),
  localDate: z.string(),
  due: z.boolean(),
  reason: z.enum(['closed', 'day_end']).nullable(),
  /** Orders the kitchen took that day and that weren't cancelled. */
  orders: z.number().int(),
  /** Orders that timed out on the kitchen (M-01), pauses excluded. */
  missed: z.number().int(),
  /**
   * Share of orders ready by the promise (2-min grace), a missed order counting as not on time
   * (2026-10-06: "100%" beside "فاتك 3" read as a contradiction); null without a sample.
   */
  onTimeShare: z.number().nullable(),
  /** The share's denominator: orders marked ready against a promise, plus missed orders. */
  onTimeSamples: z.number().int(),
  rejected: z.number().int(),
  /** Net to the merchant that day (sales − commission + fees − own deals); owner only. */
  netIqd: Iqd.nullable(),
  advice: z.object({ kind: DayAdviceKind, minutes: z.number().int().nullable(), percent: z.number().int().nullable() }).nullable(),
  /** The WhatsApp text (Iraqi plurals, Western digits), ready to share. */
  share_ar: z.string(),
});
export type MerchantDaySummary = z.infer<typeof MerchantDaySummary>;

// ───────────────────────── staff ─────────────────────────

export const StaffMember = z.object({
  personId: z.string(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  role: MerchantStaffRole,
  you: z.boolean(),
  /** Invited but has not signed in yet (the invite is waiting). */
  pending: z.boolean().default(false),
  /**
   * Pending rows only: the invited number as "0770 ••• 4567" (the owner typed it; the name stays
   * hidden until the invitee signs in). Additive (2026-10-04 follow-up).
   */
  phoneHint: z.string().nullable().optional(),
  /** Pending rows only: when the role was given (the invite). */
  invitedAt: z.coerce.date().nullable().optional(),
  /** Pending rows only: when the invite link last went out (the invite, or the latest resend). */
  inviteSentAt: z.coerce.date().nullable().optional(),
  /** Pending rows only: a resend is allowed from this time (one per `STAFF_INVITE_RULES.resendCooldownMin`). */
  resendAfter: z.coerce.date().nullable().optional(),
});
export type StaffMember = z.infer<typeof StaffMember>;

/** Re-sending a staff invite (WhatsApp link with the store name): at most once per cooldown. */
export const STAFF_INVITE_RULES = { resendCooldownMin: 10 } as const;

export const InviteStaffInput = MerchantScope.extend({
  phone: z.string().min(7).max(20),
  role: MerchantStaffRole.default('merchant_staff'),
});
export const SetStaffRoleInput = MerchantScope.extend({
  personId: z.string().min(1),
  role: MerchantStaffRole,
});
export const RemoveStaffInput = MerchantScope.extend({ personId: z.string().min(1) });
/** Sends a pending invite again (`staff_invite_not_pending` once he signed in; within the cooldown it is a no-op). */
export const ResendStaffInviteInput = MerchantScope.extend({ personId: z.string().min(1) });

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
  moneyCash(actor: Actor, input: MerchantScope): Promise<MerchantCashAccount>;
  moneyStatement(actor: Actor, input: z.infer<typeof StatementInput>): Promise<WeeklyStatement>;
  moneyDisputes(actor: Actor, input: MerchantScope): Promise<MerchantDispute[]>;
  moneyRespondDispute(actor: Actor, input: z.output<typeof RespondDisputeInput>): Promise<MerchantDispute>;
  insights(actor: Actor, input: z.output<typeof InsightsInput>): Promise<MerchantInsights>;
  /** S-M6: the end-of-day card (owner and staff; the net is the owner's). */
  daySummary(actor: Actor, input: z.output<typeof DaySummaryInput>): Promise<MerchantDaySummary>;
  staffList(actor: Actor, input: MerchantScope): Promise<StaffMember[]>;
  staffInvite(actor: Actor, input: z.output<typeof InviteStaffInput>): Promise<StaffMember>;
  staffSetRole(actor: Actor, input: z.infer<typeof SetStaffRoleInput>): Promise<StaffMember>;
  staffRemove(actor: Actor, input: z.infer<typeof RemoveStaffInput>): Promise<{ removed: boolean }>;
  staffResendInvite(
    actor: Actor,
    input: z.infer<typeof ResendStaffInviteInput>,
  ): Promise<StaffMember>;
  /** Joy h2 «قدر اليوم»: today's pot, last week's and the recent ones (owner and staff). */
  potGet(actor: Actor, input: MerchantScope): Promise<MerchantPotView>;
  potSet(actor: Actor, input: z.output<typeof SetPotInput>): Promise<MerchantPotView>;
  potClear(actor: Actor, input: MerchantScope): Promise<MerchantPotView>;
  /** Joy h5 «مطاعمنا»: the kitchen's story (staff read; the owner writes and decides if it shows). */
  storyGet(actor: Actor, input: MerchantScope): Promise<KitchenStoryView>;
  storySet(actor: Actor, input: z.output<typeof SetKitchenStoryInput>): Promise<KitchenStoryView>;
  /** «مين سوّى شنو»: the day's kitchen actions with who did each (owner only; staff FORBIDDEN). */
  activityToday(actor: Actor, input: z.output<typeof ActivityTodayInput>): Promise<MerchantActivity>;
  /** One order's kitchen actions with who did each (owner only; staff FORBIDDEN). */
  activityOrder(actor: Actor, input: z.output<typeof OrderWhoInput>): Promise<OrderWho>;
}

// ───────────────────────── who pressed what (owner only) ─────────────────────────

/**
 * One kitchen action on the owner's «مين سوّى شنو» feed: accepted (by hand or by itself), offered a
 * partial order, rejected (by hand or timed out), marked ready, took «+5 د», handed the bag over,
 * marked a dish sold out or back on.
 */
export const ActivityKind = z.enum(['accept', 'auto_accept', 'partial', 'reject', 'auto_reject', 'ready', 'extend', 'hand_over', 'sold_out', 'back_on']);
export type ActivityKind = z.infer<typeof ActivityKind>;

/**
 * Who did it: a person who holds or held a role at the store. `name` only (never a phone); null for
 * a deleted person or a missing name (the app shows «موظف سابق»). `you`: the viewer himself.
 */
export const ActivityWho = z.object({ personId: z.string(), name: z.string().nullable(), you: z.boolean() });
export type ActivityWho = z.infer<typeof ActivityWho>;

export const ActivityEntry = z.object({
  at: z.coerce.date(),
  kind: ActivityKind,
  /** The order (order kinds); null for a dish action. */
  orderId: z.string().nullable(),
  /** The kitchen ticket number ("#6347"); null for a dish action. */
  orderNumber: z.string().nullable(),
  /** The dish (sold out / back on); null for an order action. */
  dishName: z.string().nullable(),
  /** Sold out until (e.g. «خلص اليوم» until midnight); null when until put back by hand. */
  until: z.coerce.date().nullable(),
  /** Null for what the system did by itself (`auto_accept`, `auto_reject`). */
  who: ActivityWho.nullable(),
  /** Rejection reason as stored (`busy`, `closing`, `merchant_timeout`…); null otherwise. */
  reason: z.string().nullable(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** `date` = a Baghdad local day (YYYY-MM-DD); default today. */
export const ActivityTodayInput = MerchantScope.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export type ActivityTodayInput = z.input<typeof ActivityTodayInput>;

/** Newest first, at most `MERCHANT_ACTIVITY_MAX` entries. */
export const MerchantActivity = z.object({ merchantOrgId: z.string(), localDate: z.string(), entries: z.array(ActivityEntry) });
export type MerchantActivity = z.infer<typeof MerchantActivity>;
export const MERCHANT_ACTIVITY_MAX = 200;

export const OrderWhoInput = MerchantScope.extend({ orderId: z.string().min(1) });
export type OrderWhoInput = z.input<typeof OrderWhoInput>;

/** One order's kitchen actions, oldest first (the order sheet's «قبله منتظر 9:32 · جهّزه علي 9:51»). */
export const OrderWho = z.object({ orderId: z.string(), entries: z.array(ActivityEntry) });
export type OrderWho = z.infer<typeof OrderWho>;
