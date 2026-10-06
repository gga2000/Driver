import { z } from 'zod';
import { t, type Locale, type MessageKey } from '@driver/i18n';
import { Iqd } from './common.js';
import { LedgerEventType } from './ledger.js';
import { CapRole, CapTier, CommissionTier, SettlementMode, TakeClass } from './ledger-rules.js';

/**
 * The money facts inside the domain events the ledger reacts to (domain §6; the event payloads
 * themselves are in `domain-events.ts`), and the IO of the ledger router. The ledger turns each
 * fact into one balanced posting group. Amounts are what the locked quote charged — the ledger only
 * splits them (commission, take, points), it never re-prices.
 */

export const LedgerPaymentMethod = z.enum(['cash', 'wallet']);
export type LedgerPaymentMethod = z.infer<typeof LedgerPaymentMethod>;

const Payer = {
  customerId: z.string().min(1),
  /** Household wallet pays instead of the customer's own (domain §12). */
  householdId: z.string().min(1).optional(),
  payment: LedgerPaymentMethod,
  /**
   * Actual cash handed over; defaults to the price rounded up to 250 (`cashToHand`). Less = wallet
   * debt, more = change credited to the wallet ("الباقي رصيد", `cash_rounding_credit`).
   */
  cashCollectedIqd: Iqd.nonnegative().optional(),
  /**
   * "الخردة علينا" (2026-10-05): of `cashCollectedIqd`, what the courier could not give back in change
   * and goes to the customer's wallet as its own line (`cash_change_to_wallet`, "باقي الكاش"), apart
   * from the 0–249 rounding change. Cash only; the orders module has already checked it.
   */
  changeToWalletIqd: Iqd.positive().optional(),
  /** Points the customer redeems (100 = 1,000 IQD), against the delivery fee first, then the service fee (J-D10, `pointsRedemption`). */
  pointsRedeemed: z.number().int().nonnegative().default(0),
  /** Legacy (G-88 500-step rounding): ignored since the 250 change-to-wallet rule (2026-10-04). */
  has250Component: z.boolean().default(false),
  /** Referrer of this customer, if any (decisions §1). */
  referredBy: z.string().min(1).optional(),
};

/** Points per line go to the tagged participant; phone-only participants get pending points (domain §3). */
export const ParticipantShare = z
  .object({ personId: z.string().min(1).optional(), phoneHash: z.string().min(1).optional(), itemsIqd: Iqd.nonnegative() })
  .refine((p) => Boolean(p.personId) !== Boolean(p.phoneHash), { message: 'exactly one of personId or phoneHash' });
export type ParticipantShare = z.infer<typeof ParticipantShare>;

export const OrderMoneyPayload = z.object({
  orderId: z.string().min(1),
  tripId: z.string().min(1).optional(),
  orderType: z.enum(['food', 'grocery_catalog']),
  occurredAt: z.coerce.date(),
  ...Payer,
  merchantId: z.string().min(1),
  /** Absent for pickup orders: the merchant collects the cash. */
  courierId: z.string().min(1).optional(),
  /** Items at menu prices. Commission base (G-87) = this minus a merchant `items` deal; service fee and delivery are outside it. */
  itemsSubtotalIqd: Iqd.nonnegative(),
  commissionTier: CommissionTier,
  serviceFeeIqd: Iqd.nonnegative().optional(),
  smallOrderFeeIqd: Iqd.nonnegative().default(0),
  /** Every delivery component the customer pays (band, night, rain, door…). */
  deliveryFeeIqd: Iqd.nonnegative().default(0),
  /** What the courier earns of it; defaults to all of it, or the batched share for a batched second order. */
  courierDeliveryIqd: Iqd.nonnegative().optional(),
  batchedSecond: z.boolean().default(false),
  tipIqd: Iqd.nonnegative().default(0),
  platformPromo: z.object({ promotionId: z.string().min(1), amountIqd: Iqd.positive() }).optional(),
  /**
   * A merchant-funded deal (domain §11, G-87). `items`: comes off the dishes, so the commission base is
   * `itemsSubtotalIqd − amountIqd`; `delivery`: free delivery — the courier still earns the full fee,
   * the merchant pays it. Posted as `promo_funded` merchant → customer, memo `deal:<promotionId>`.
   */
  merchantDeal: z.object({ promotionId: z.string().min(1), target: z.enum(['items', 'delivery']), amountIqd: Iqd.positive() }).optional(),
  participants: z.array(ParticipantShare).default([]),
});
export type OrderMoneyPayload = z.input<typeof OrderMoneyPayload>;

export const ErrandMoneyPayload = z.object({
  orderId: z.string().min(1),
  tripId: z.string().min(1).optional(),
  occurredAt: z.coerce.date(),
  ...Payer,
  shopperId: z.string().min(1),
  /** Receipt total the shopper paid from float. */
  actualCostIqd: Iqd.nonnegative(),
  errandFeeIqd: Iqd.nonnegative(),
  serviceFeeIqd: Iqd.nonnegative().optional(),
  tipIqd: Iqd.nonnegative().default(0),
});
export type ErrandMoneyPayload = z.input<typeof ErrandMoneyPayload>;

export const RideTakeClass = TakeClass.extract(['tuktuk', 'car', 'intercity_private', 'parcel', 'parcel_intercity']);
export const RideMoneyPayload = z.object({
  tripId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  occurredAt: z.coerce.date(),
  ...Payer,
  driverId: z.string().min(1),
  takeClass: RideTakeClass,
  fareIqd: Iqd.positive(),
  tipIqd: Iqd.nonnegative().default(0),
  /** Rebroadcast compensation (decisions §6), platform-funded, only for eligible drivers. */
  pickupCompensationIqd: Iqd.nonnegative().default(0),
});
export type RideMoneyPayload = z.input<typeof RideMoneyPayload>;

export const SeatMoneyPayload = z.object({
  seatId: z.string().min(1),
  departureId: z.string().min(1),
  routeId: z.string().min(1).optional(),
  occurredAt: z.coerce.date(),
  ...Payer,
  driverId: z.string().min(1),
  fareIqd: Iqd.positive(),
  frontPremiumIqd: Iqd.nonnegative().default(0),
  /** Walk-up seats carry no commission at launch (domain §2). */
  walkUp: z.boolean().default(false),
});
export type SeatMoneyPayload = z.input<typeof SeatMoneyPayload>;

export const LateMeterPayload = z.object({
  departureId: z.string().min(1),
  seatId: z.string().min(1).optional(),
  occurredAt: z.coerce.date(),
  /** Server-computed (decisions §8). */
  minutesLate: z.number().int().nonnegative(),
  late: z.object({ kind: z.enum(['rider', 'driver']), id: z.string().min(1) }),
  driverId: z.string().min(1),
  /** Boarded riders who waited (excluding the late rider). */
  waitingRiderIds: z.array(z.string().min(1)).default([]),
});
export type LateMeterPayload = z.input<typeof LateMeterPayload>;

export const DepartureCancelledPayload = z.object({
  departureId: z.string().min(1),
  routeId: z.string().min(1).optional(),
  occurredAt: z.coerce.date(),
  driverId: z.string().min(1),
  cancelledBy: z.enum(['driver', 'low_fill']),
  /** Driver's fee when cancelling inside 2 h, shared equally by the booked riders as credit. */
  feeIqd: Iqd.nonnegative().default(0),
  riderIds: z.array(z.string().min(1)).default([]),
});
export type DepartureCancelledPayload = z.input<typeof DepartureCancelledPayload>;

export const SubscriptionChargePayload = z.object({
  subscriptionId: z.string().min(1),
  routeId: z.string().min(1),
  occurredAt: z.coerce.date(),
  /** Billing cycle key (e.g. `2026-11`), part of the idempotency key. */
  cycle: z.string().min(1),
  ...Payer,
  driverId: z.string().min(1),
  amountIqd: Iqd.positive(),
  prorated: z.boolean().default(false),
});
export type SubscriptionChargePayload = z.input<typeof SubscriptionChargePayload>;

export const SettlementRequestReason = z.enum(['merchant_request', 'exposure_cap', 'mode_schedule']);
export type SettlementRequestReason = z.infer<typeof SettlementRequestReason>;

export const MerchantSettlementRequestedPayload = z.object({
  merchantId: z.string().min(1),
  occurredAt: z.coerce.date(),
  reason: SettlementRequestReason,
  requestedBy: z.string().min(1).optional(),
  balanceIqd: Iqd,
  /** G-82 reference of the request; the assignment reuses it so the Merchant app can follow one request end to end. */
  reference: z.string().min(1).optional(),
});
export type MerchantSettlementRequestedPayload = z.input<typeof MerchantSettlementRequestedPayload>;

// ───────────────────────── router IO ─────────────────────────

export const StatementLine = z.object({
  id: z.string(),
  occurredAt: z.coerce.date(),
  type: LedgerEventType,
  label_ar: z.string(),
  label_en: z.string(),
  accountId: z.string(),
  counterparty: z.string(),
  /** Signed for this account: + received, − paid out. */
  amountIqd: Iqd,
  balanceAfterIqd: Iqd,
  orderId: z.string().optional(),
  tripId: z.string().optional(),
  memo: z.string().optional(),
});
export type StatementLine = z.infer<typeof StatementLine>;

export const Statement = z.object({
  accountId: z.string(),
  from: z.coerce.date().nullable(),
  to: z.coerce.date().nullable(),
  openingIqd: Iqd,
  closingIqd: Iqd,
  inIqd: Iqd,
  outIqd: Iqd,
  lines: z.array(StatementLine),
});
export type Statement = z.infer<typeof Statement>;

export const DateRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

export const DriverLedgerInput = DateRange.extend({ driverId: z.string().min(1).optional() });
export const DriverLedgerView = z.object({
  driverId: z.string(),
  role: CapRole,
  tier: CapTier,
  earningsBalanceIqd: Iqd,
  cashBalanceIqd: Iqd,
  /** Cash not yet returned to merchants plus fees and commission owed (decisions §3). */
  owedIqd: Iqd,
  capIqd: Iqd,
  capRemainingIqd: Iqd,
  overCap: z.boolean(),
  /** G-86: what the platform should pay out to this driver now. */
  payoutDueIqd: Iqd,
  earnings: Statement,
  cash: Statement,
});
export type DriverLedgerView = z.infer<typeof DriverLedgerView>;

export const MerchantBalanceInput = z.object({ merchantId: z.string().min(1) });
export const MerchantBalanceView = z.object({
  merchantId: z.string(),
  /** Live balance: what the merchant is owed now (negative = the merchant owes commission). */
  balanceIqd: Iqd,
  mode: SettlementMode,
  exposureCapIqd: Iqd,
  overExposure: z.boolean(),
  /** Couriers holding this merchant's cash right now. */
  holders: z.array(z.object({ courierId: z.string(), amountIqd: Iqd })),
  lastSettledAt: z.coerce.date().nullable(),
  lastRequestedAt: z.coerce.date().nullable(),
});
export type MerchantBalanceView = z.infer<typeof MerchantBalanceView>;

export const RequestSettlementInput = z.object({ merchantId: z.string().min(1) });
export const SettlementPlan = z.object({
  merchantId: z.string(),
  amountIqd: Iqd,
  channel: z.enum(['courier', 'ops_round', 'zaincash', 'bank']),
  courierId: z.string().optional(),
  /** G-82 reference typed into the ZainCash note or printed on the ops receipt. */
  reference: z.string(),
  /** Decisions §3: on-demand target within the hour. */
  targetBy: z.coerce.date(),
  reason: SettlementRequestReason,
});
export type SettlementPlan = z.infer<typeof SettlementPlan>;

export const BookCheck = z.object({ ok: z.boolean(), net: Iqd, events: z.number().int() });
export const NightlyReport = z.object({
  runAt: z.coerce.date(),
  ok: z.boolean(),
  money: BookCheck,
  points: BookCheck,
  /** Rows whose kind disagrees with their type or accounts (should be impossible past `record`). */
  kindViolations: z.number().int(),
  drivers: z.array(
    z.object({ driverId: z.string(), owedIqd: Iqd, capIqd: Iqd, capRemainingIqd: Iqd, overCap: z.boolean(), payoutDueIqd: Iqd }),
  ),
  incidentId: z.string().nullable(),
  message_ar: z.string(),
});
export type NightlyReport = z.infer<typeof NightlyReport>;

/** What the ledger module exposes to the transport. Implemented by apps/api, consumed by the router. */
export interface LedgerPort {
  driverLedger(input: { driverId: string; from?: Date; to?: Date }): Promise<DriverLedgerView>;
  merchantBalance(merchantId: string): Promise<MerchantBalanceView>;
  requestSettlement(input: { merchantId: string; requestedBy: string }): Promise<SettlementPlan>;
  runNightly(input: { requestedBy: string }): Promise<NightlyReport>;
}

/** Arabic (default) or English label of a ledger line, from packages/i18n (`ledger.line.<type>`). */
export function ledgerLineLabel(type: LedgerEventType, locale: Locale = 'ar-IQ'): string {
  return t(`ledger.line.${type}` as MessageKey, undefined, locale);
}

/** The Console's nightly-close line: "الدفتر متوازن ✓" or the two nets that failed. */
export function nightlyMessage(ok: boolean, moneyNet: number, pointsNet: number, locale: Locale = 'ar-IQ'): string {
  return ok ? t('ledger.nightly_ok', undefined, locale) : t('ledger.nightly_failed', { money: moneyNet, points: pointsNet }, locale);
}
