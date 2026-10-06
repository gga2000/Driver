import { z } from 'zod';
import { Iqd } from './common.js';

/**
 * Money rules the ledger posts by (money & ops spec §1–5, edge-case decisions §1–4, edge-case
 * review G). Every figure is config per city — `AZIZIYAH_MONEY_RULES` is the launch default —
 * never a literal inside a posting function.
 */

const Rate = z.number().min(0).max(1);

/** Restaurant commission tier (money §1); the base is the item subtotal after merchant-funded discounts (G-87). */
export const CommissionTier = z.enum(['base', 'featured', 'marketing', 'pickup']);
export type CommissionTier = z.infer<typeof CommissionTier>;

/** Ride/seat/parcel service classes with their own platform take (money §3). */
export const TakeClass = z.enum(['tuktuk', 'car', 'intercity_seat', 'front_seat_premium', 'intercity_private', 'khat_seat', 'parcel', 'parcel_intercity']);
export type TakeClass = z.infer<typeof TakeClass>;

export const TakeRule = z.object({
  rate: Rate,
  /** Floor on the take (tuktuk 10 % min 100). */
  minIqd: Iqd.nonnegative().default(0),
  /** Fixed amount on top of the rate (khat 8 % + 1,000 per rider-month). */
  fixedIqd: Iqd.nonnegative().default(0),
});
export type TakeRule = z.infer<typeof TakeRule>;

/** Who a cash cap applies to (G-80: caps by role). */
export const CapRole = z.enum(['courier', 'driver', 'intercity_driver', 'khat_driver']);
export type CapRole = z.infer<typeof CapRole>;
export const CapTier = z.enum(['bronze', 'silver', 'gold']);
export type CapTier = z.infer<typeof CapTier>;

export const SettlementMode = z.enum(['nightly_courier', 'on_demand', 'daily_zaincash', 'weekly_bulk']);
export type SettlementMode = z.infer<typeof SettlementMode>;

const CapsByTier = z.object({ bronze: Iqd.positive(), silver: Iqd.positive(), gold: Iqd.positive() });

/**
 * A peak shift on the city's clock (G-91 shift guarantee): `[startMin, endMin)` minutes after local
 * midnight, inside one local day. `key` names it in the ledger memo (`guarantee:2026-10-04:lunch`).
 */
export const PeakShift = z
  .object({
    key: z.string().regex(/^[a-z][a-z_]*$/),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
  })
  .refine((p) => p.endMin > p.startMin, { message: 'a peak shift ends after it starts, on the same local day' });
export type PeakShift = z.infer<typeof PeakShift>;

/**
 * Aziziyah's two 4-hour peak shifts (2026-10-06, for Ali's G-91 decision): the guarantee is "per
 * 4-hour peak shift" and the city's peaks are lunch 13:00–15:00 and dinner 19:30–22:30 (edge-case
 * review #21), so each shift is the 4 hours around its peak: lunch 12:00–16:00, dinner 19:00–23:00.
 */
export const AZIZIYAH_PEAK_SHIFTS: readonly PeakShift[] = [
  { key: 'lunch', startMin: 12 * 60, endMin: 16 * 60 },
  { key: 'dinner', startMin: 19 * 60, endMin: 23 * 60 },
];

export const MoneyRules = z.object({
  commission: z.object({ base: Rate, featured: Rate, marketing: Rate, pickup: Rate }),
  serviceFeeIqd: Iqd.nonnegative(),
  /**
   * J-D6 (Ali, 2026-10-05): `feeIqd` is charged on an order below the restaurant's own minimum
   * (`smallOrderFeeIqd`). `belowIqd` is the city's typical minimum, kept for reference; the
   * restaurant's `minOrderIqd` is the threshold that applies.
   */
  smallOrder: z.object({ belowIqd: Iqd.nonnegative(), feeIqd: Iqd.nonnegative() }),
  /** Batched second order: courier earns this share of its delivery fee; the customer pays in full (money §2). */
  batchedSecondCourierShare: Rate,
  take: z.object({
    tuktuk: TakeRule,
    car: TakeRule,
    intercity_seat: TakeRule,
    front_seat_premium: TakeRule,
    intercity_private: TakeRule,
    khat_seat: TakeRule,
    parcel: TakeRule,
    parcel_intercity: TakeRule,
  }),
  /**
   * Ali, 2026-10-04 (UI/UX audit C-07, replaces G-88's "multiples of 500"): a cash customer hands over
   * his price rounded **up** to this step; the remainder is his change, credited to his wallet
   * ("الباقي رصيد"). Wallet payments pay the exact price. See `cashToHand`.
   */
  rounding: z.object({ stepIqd: Iqd.positive() }),
  /**
   * Phase 3 "الخردة علينا" (2026-10-05, awaiting Ali's final OK — edge-case decisions): when the courier
   * has no change, the rest of the customer's note goes to his wallet. `maxIqd` caps that credit per
   * order (more must be handed back in cash); `tenderMaxOverIqd` caps the note a customer may say he
   * will pay with, above his total (a 50,000 note for any order).
   */
  changeToWallet: z.object({ maxIqd: Iqd.positive(), tenderMaxOverIqd: Iqd.positive() }).default({ maxIqd: 25_000, tenderMaxOverIqd: 50_000 }),
  points: z.object({
    /** Decisions §2: 1 point per this much platform revenue (service fee + commission) on food/grocery/parcels/errands. */
    revenueIqdPerPoint: Iqd.positive(),
    /** Rides and seats: 1 point per this much platform take. */
    rideTakeIqdPerPoint: Iqd.positive(),
    maxPerOrder: z.number().int().positive(),
    organizerBonusRate: Rate,
    /** 100 points = 1,000 IQD. */
    pointValueIqd: Iqd.positive(),
  }),
  referral: z.object({
    pointsPerSide: z.number().int().positive(),
    minOrderIqd: Iqd.nonnegative(),
    /** Unlocks on the referee's Nth completed cash order ≥ minOrderIqd. */
    unlockOnQualifyingOrder: z.number().int().positive(),
    monthlyCapPerReferrer: z.number().int().positive(),
  }),
  caps: z.object({
    byRole: z.object({ courier: CapsByTier, driver: CapsByTier, intercity_driver: CapsByTier, khat_driver: CapsByTier }),
    /** G-80: a single job may push a driver over the cap when its value ≤ this share of the cap. */
    singleJobShareOfCap: Rate,
  }),
  newCustomerCash: z.object({ maxOrderIqd: Iqd.positive(), firstOrders: z.number().int().positive() }),
  merchant: z.object({ exposureCapIqd: Iqd.positive(), defaultMode: SettlementMode }),
  adjustments: z.object({ secondApproverAboveIqd: Iqd.nonnegative() }),
  /** G-86: platform → driver payout when the platform owes the driver more than this (or weekly). */
  driverPayoutAboveIqd: Iqd.nonnegative(),
  /**
   * G-91 launch shift guarantee (money §2, edge-case review #91; Ali decided 2026-10-06 to pay it):
   * per peak shift, a driver whose cap role is in `roles` and who met the three conditions in it is
   * topped up by the platform to `amountIqd` (the difference, never a flat bonus), paid on the Sunday
   * run with the scorecard. `enabled` is the city's switch. See `shiftGuarantee` and
   * docs/api/shift-guarantee.md.
   */
  guarantee: z.object({
    enabled: z.boolean().default(true),
    amountIqd: Iqd.nonnegative(),
    minAcceptance: Rate,
    maxCancelsAfterAccept: z.number().int().nonnegative(),
    minCompletedJobs: z.number().int().nonnegative(),
    peaks: z.array(PeakShift).min(1).default([...AZIZIYAH_PEAK_SHIFTS]),
    /** Money §2 / §5 "courier shift guarantees": food couriers at launch. */
    roles: z.array(CapRole).min(1).default(['courier']),
  }),
  /** Domain §2 seat lateness meter; decisions §8 binds it to server time. */
  lateMeter: z.object({
    graceMin: z.number().int().nonnegative(),
    blockMin: z.number().int().positive(),
    capMin: z.number().int().positive(),
    riderLateToDriverPerBlockIqd: Iqd.nonnegative(),
    riderLateToEachRiderPerBlockIqd: Iqd.nonnegative(),
    driverLateToEachRiderPerBlockIqd: Iqd.nonnegative(),
  }),
  /** Nightly close (money §4): 02:00 in the city's zone. */
  nightly: z.object({ hour: z.number().int().min(0).max(23), utcOffsetMin: z.number().int() }),
  /**
   * The honest-delay promise (customer spec §4, audit d-5; two steps, Ali 2026-10-06):
   * - `apologyAfterMin` past the time we promised, still not at the door: one proactive apology with
   *   the new time (push, SMS twin), once per order. No money.
   * - `afterMin` past it: the delivery fee the customer pays comes back as wallet credit, paid by the
   *   platform, once per order (`latePromiseTerms`). A free-delivery order (fee 0 after deals) gets
   *   `freeDeliveryCreditIqd` instead, so every food delivery carries the promise.
   * Shown at checkout, on the late banner and on the welcome screen with these numbers, never a
   * literal in the apps.
   */
  latePromise: z
    .object({ afterMin: z.number().int().positive(), apologyAfterMin: z.number().int().positive(), freeDeliveryCreditIqd: Iqd.nonnegative() })
    .refine((r) => r.apologyAfterMin < r.afterMin, { message: 'the apology comes before the credit' })
    .default({ afterMin: 20, apologyAfterMin: 10, freeDeliveryCreditIqd: 1000 }),
});
export type MoneyRules = z.infer<typeof MoneyRules>;

export const AZIZIYAH_MONEY_RULES: MoneyRules = MoneyRules.parse({
  commission: { base: 0.12, featured: 0.15, marketing: 0.18, pickup: 0.05 },
  serviceFeeIqd: 500,
  smallOrder: { belowIqd: 5000, feeIqd: 500 },
  batchedSecondCourierShare: 0.7,
  take: {
    tuktuk: { rate: 0.1, minIqd: 100 },
    car: { rate: 0.12 },
    intercity_seat: { rate: 0.1 },
    front_seat_premium: { rate: 0.25 },
    intercity_private: { rate: 0.08 },
    khat_seat: { rate: 0.08, fixedIqd: 1000 },
    parcel: { rate: 0.15 },
    parcel_intercity: { rate: 0.15 },
  },
  rounding: { stepIqd: 250 },
  changeToWallet: { maxIqd: 25_000, tenderMaxOverIqd: 50_000 },
  points: { revenueIqdPerPoint: 100, rideTakeIqdPerPoint: 200, maxPerOrder: 50, organizerBonusRate: 0.1, pointValueIqd: 10 },
  referral: { pointsPerSide: 200, minOrderIqd: 10000, unlockOnQualifyingOrder: 2, monthlyCapPerReferrer: 10 },
  caps: {
    byRole: {
      courier: { bronze: 75000, silver: 150000, gold: 300000 },
      driver: { bronze: 75000, silver: 150000, gold: 300000 },
      khat_driver: { bronze: 75000, silver: 150000, gold: 300000 },
      intercity_driver: { bronze: 300000, silver: 300000, gold: 300000 },
    },
    singleJobShareOfCap: 0.5,
  },
  newCustomerCash: { maxOrderIqd: 25000, firstOrders: 3 },
  merchant: { exposureCapIqd: 300000, defaultMode: 'nightly_courier' },
  adjustments: { secondApproverAboveIqd: 25000 },
  driverPayoutAboveIqd: 20000,
  guarantee: { enabled: true, amountIqd: 10000, minAcceptance: 0.85, maxCancelsAfterAccept: 1, minCompletedJobs: 3, peaks: [...AZIZIYAH_PEAK_SHIFTS], roles: ['courier'] },
  lateMeter: {
    graceMin: 5,
    blockMin: 10,
    capMin: 20,
    riderLateToDriverPerBlockIqd: 1000,
    riderLateToEachRiderPerBlockIqd: 500,
    driverLateToEachRiderPerBlockIqd: 1000,
  },
  nightly: { hour: 2, utcOffsetMin: 180 },
  latePromise: { afterMin: 20, apologyAfterMin: 10, freeDeliveryCreditIqd: 1000 },
});

/** The cash step Aziziyah totals round to (Ali, 2026-10-04): 250 IQD. */
export const CASH_STEP_IQD = 250;

/**
 * What a cash customer hands over for a price, and his change (Ali's rounding decision, 2026-10-04):
 * the price rounded **up** to the step (250) and the remainder (0–249) credited to his wallet as
 * "الباقي رصيد" — never a "تقريب +" line that raises the price. The change is the customer's own cash:
 * the courier collects it (it counts on his cash cap like the rest) and the ledger books it as
 * `cash_rounding_credit` into the customer's wallet; no merchant or deal pays for it. Wallet and
 * prepaid orders pay the exact price (no cash, no change). Shared by the API (quote, place, ledger)
 * and the apps (cart, checkout, receipts), so the number is the same everywhere.
 */
export function cashToHand(priceIqd: number, stepIqd: number = CASH_STEP_IQD): { cashIqd: number; changeIqd: number } {
  if (!(priceIqd > 0)) return { cashIqd: 0, changeIqd: 0 };
  const cashIqd = Math.ceil(priceIqd / stepIqd) * stepIqd;
  return { cashIqd, changeIqd: cashIqd - priceIqd };
}

/**
 * What the honest-delay credit is: the delivery fee the customer pays comes back (`delivery_fee`), or —
 * when he pays none (free-delivery deal) — a fixed `flat` amount, so the apps can say "أجرة التوصيل"
 * only when it is one.
 */
export const LatePromiseBasis = z.enum(['delivery_fee', 'flat']);
export type LatePromiseBasis = z.infer<typeof LatePromiseBasis>;

/**
 * What the honest-delay promise gives back on a delivery (Ali, 2026-10-06): the delivery fee the
 * customer actually pays; a free-delivery order (0 after deals) gets `freeDeliveryCreditIqd`. Null
 * only if that is configured to 0. Callers decide which orders are deliveries with a promise.
 */
export function latePromiseTerms(
  o: { deliveryFeeIqd: number; discount?: { target: string; amountIqd: number } | null },
  rules: MoneyRules['latePromise'] = AZIZIYAH_MONEY_RULES.latePromise,
): { creditIqd: number; basis: LatePromiseBasis } | null {
  const free = o.discount?.target === 'delivery' ? o.discount.amountIqd : 0;
  const paid = Math.max(0, o.deliveryFeeIqd - free);
  if (paid > 0) return { creditIqd: paid, basis: 'delivery_fee' };
  return rules.freeDeliveryCreditIqd > 0 ? { creditIqd: rules.freeDeliveryCreditIqd, basis: 'flat' } : null;
}

/** The honest-delay credit's amount (`latePromiseTerms`); 0 = no promise. */
export function latePromiseCreditIqd(o: { deliveryFeeIqd: number; discount?: { target: string; amountIqd: number } | null }, rules: MoneyRules['latePromise'] = AZIZIYAH_MONEY_RULES.latePromise): number {
  return latePromiseTerms(o, rules)?.creditIqd ?? 0;
}
