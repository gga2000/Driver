import { AZIZIYAH_MONEY_RULES, type CommissionTier, type VehicleClass } from '@driver/contracts';
import type { PauseWindow } from './pause.js';

/**
 * Orders timing and money rules (domain §2–3, dispatch & pricing §4, edge-case decisions + review A).
 * Numbers that will move into per-city config in a later step live here, in one place.
 */
export const ORDERS_RULES = {
  /** Domain §2: merchant must accept within 90 s or the order auto-rejects with a dispatch alert. */
  merchantAcceptSec: 90,
  /** Domain §2: `closed` auto 2 h after delivery without complaint (or on rating). */
  autoCloseMs: 2 * 60 * 60_000,
  /** Review A.4: the customer has 60 s to approve a partial acceptance. */
  partialApprovalSec: 60,
  /** Review A.12: scheduled orders are offered to the merchant at T − prep − 10 min. */
  scheduledLeadMin: 10,
  defaultPrepMin: 20,
  /** Review A.2: merchant app silent for this long counts as "no presence". */
  heartbeatStaleMs: 2 * 60_000,
  /** Review A.2: no `ready` by promised + 10 min and no presence → dispatcher card with call. */
  readyOverdueMin: 10,
  /** Review A.2: … and the courier is released at promised + 15 min, 500 charged to the merchant. */
  courierReleaseMin: 15,
  courierReleaseCompensationIqd: 500,
  /** Spec §4: merchant rejects after accepting → 500 customer credit funded by the merchant. */
  merchantLateRejectCreditIqd: 500,
  /**
   * Money §1 tier for merchants without one on file: `featured` (15 %) keeps the worked example
   * (2,250 on 15,000) and the pre-tier default. The rate itself comes from the money rules.
   */
  defaultCommissionTier: 'featured' as CommissionTier,
  /** Money §3: car in city 12 %. Ride orders do not carry their vertical yet, so cars set the rate. */
  rideTakePct: 12,
  /** Edge-case §2: 1 point per 100 IQD of platform revenue (rides 1 per 200), capped per order. */
  pointsPerIqd: 100,
  ridePointsPerIqd: 200,
  pointsCapPerOrder: 50,
  /** Domain §3/§10: organiser bonus +10 % of the order's points. */
  organizerBonusPct: 10,
  /**
   * J-D6 (Ali, 2026-10-05): an order whose items (menu prices, before any deal) are below the
   * restaurant's minimum goes ahead with this fee (500), from the city's money rules.
   */
  smallOrder: AZIZIYAH_MONEY_RULES.smallOrder,
  /** W-02 / J-D10: 100 points = 1,000 دينار, spent on the delivery fee first, then the service fee. */
  pointValueIqd: AZIZIYAH_MONEY_RULES.points.pointValueIqd,
  /** M2 review follow-up: the customer's tip is capped per order; it goes 100 % to the courier/driver. */
  maxTipIqd: 10_000,
  /** Domain §10: pending points for non-users expire after 90 days unclaimed. */
  pendingPointsTtlDays: 90,
  /**
   * "الخردة علينا" (2026-10-05, awaiting Ali's final OK): the money config's change-to-wallet cap
   * (25,000 per hand-over), the highest stated note above the total (50,000) and the 250 step.
   */
  changeToWallet: {
    maxIqd: AZIZIYAH_MONEY_RULES.changeToWallet.maxIqd,
    tenderMaxOverIqd: AZIZIYAH_MONEY_RULES.changeToWallet.tenderMaxOverIqd,
    stepIqd: AZIZIYAH_MONEY_RULES.rounding.stepIqd,
  },
} as const;

/** Review A.16: per-vehicle-class order caps; above the car cap the order is a catering request. */
export const ORDER_CAPS: ReadonlyArray<{ vehicleClass: VehicleClass; maxItemsIqd: number; maxItemCount: number }> = [
  { vehicleClass: 'bike', maxItemsIqd: 25_000, maxItemCount: 6 },
  { vehicleClass: 'tuktuk', maxItemsIqd: 60_000, maxItemCount: Number.POSITIVE_INFINITY },
  { vehicleClass: 'car', maxItemsIqd: 100_000, maxItemCount: Number.POSITIVE_INFINITY },
];
export const CATERING_ABOVE_IQD = 100_000;

/** Review A.1: per-merchant pause windows seeded by city — Friday prayer by default. */
export const CITY_PAUSE_WINDOWS: Readonly<Record<string, readonly PauseWindow[]>> = {
  aziziyah: [{ dow: 5, start: '11:45', end: '13:15', reason: 'صلاة الجمعة' }],
};

export const DEFAULT_TIMEZONE = 'Asia/Baghdad';

/** Commission percent of a tier, from the city's money rules (the ledger posts by the same rules). */
export function commissionPctOf(tier: CommissionTier): number {
  return Math.round(AZIZIYAH_MONEY_RULES.commission[tier] * 10_000) / 100;
}

/**
 * FOOD-03: when a shop order may be booked for (the app's «اليوم» / «باچر» slots and the r6 dinner
 * offer): at least the scheduling lead away (anything sooner is a now-order) and at most 48 hours ahead.
 */
export const FOOD_SCHEDULE_RULES = { minLeadMin: ORDERS_RULES.scheduledLeadMin, maxAheadHours: 48 } as const;

/** Why a shop order can't be booked for that time; null when it can (`order_schedule_invalid`). */
export function foodScheduleProblem(scheduledFor: Date, now: Date): 'too_soon' | 'too_far' | null {
  const ahead = scheduledFor.getTime() - now.getTime();
  if (ahead < FOOD_SCHEDULE_RULES.minLeadMin * 60_000) return 'too_soon';
  if (ahead > FOOD_SCHEDULE_RULES.maxAheadHours * 3_600_000) return 'too_far';
  return null;
}
