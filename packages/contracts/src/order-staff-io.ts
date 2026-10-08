import { z } from 'zod';
import { Iqd } from './common.js';
import { OrderState } from './order.js';
import { FaultParty } from './support-io.js';

/**
 * W3 staff way-out (NTF-01, NTF-10, NTF-11, NTF-13, SEC-10, THIN-01): the Console's audited actions
 * on a stuck order, the stuck-orders list and the customer's cash standing. Every action carries a
 * reason (written to the Console audit log) and an idempotency key. Money outcomes Ali has not
 * decided yet are refused with `money_rule_off` until their switch is on (docs/api/staff-ops.md).
 */

/** Why staff acted, in their own words (audit log). */
const Reason = z.string().trim().min(3).max(500);

export const StaffCancelOrderInput = z.object({
  orderId: z.string().min(1),
  reason: Reason,
  /**
   * The customer asked us (by phone, WhatsApp) to cancel: his normal cancellation fee applies, as if he
   * had tapped cancel. Default false: the platform cancels, free for the customer.
   */
  onBehalfOfCustomer: z.boolean().default(false),
});
export type StaffCancelOrderInput = z.infer<typeof StaffCancelOrderInput>;

export const StaffMarkDeliveredInput = z.object({
  orderId: z.string().min(1),
  reason: Reason,
  /** Cash orders: what the courier took at the door (default: the order's cash total). */
  cashCollectedIqd: Iqd.nonnegative().optional(),
});
export type StaffMarkDeliveredInput = z.infer<typeof StaffMarkDeliveredInput>;

export const StaffCloseOrderInput = z.object({ orderId: z.string().min(1), reason: Reason });
export type StaffCloseOrderInput = z.infer<typeof StaffCloseOrderInput>;

export const StaffCourierLostInput = z.object({ orderId: z.string().min(1), reason: Reason });
export type StaffCourierLostInput = z.infer<typeof StaffCourierLostInput>;

export const StaffChargeCourierInput = z.object({ orderId: z.string().min(1), reason: Reason });
export type StaffChargeCourierInput = z.infer<typeof StaffChargeCourierInput>;

/** M-1: how a complaint ends. `void` = an order that never reached the customer: nothing charged, nobody paid. */
export const DisputeOutcomeKind = z.enum(['stands', 'refund_full', 'refund_partial', 'redelivery', 'void']);
export type DisputeOutcomeKind = z.infer<typeof DisputeOutcomeKind>;

export const ResolveDisputeInput = z
  .object({
    orderId: z.string().min(1),
    outcome: DisputeOutcomeKind,
    reason: Reason,
    /** `refund_partial` only: what goes back to the wallet (≤ what he paid less earlier refunds). */
    amountIqd: Iqd.positive().optional(),
    /** Who pays a refund (as `support.refund`): the courier's earnings, the merchant's cash account, or the platform. */
    faultParty: FaultParty.default('platform'),
  })
  .refine((v) => (v.outcome === 'refund_partial') === (v.amountIqd !== undefined), { message: 'amountIqd is for refund_partial only, and it needs one', path: ['amountIqd'] });
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeInput>;

export const StaffActionResult = z.object({
  orderId: z.string(),
  state: OrderState,
  /** False when the call was a replay or the order was already there (nothing happened twice). */
  changed: z.boolean(),
  /** Money posted by this action, in IQD (refunds, kitchen pay); 0 when none. */
  postedIqd: Iqd.nonnegative(),
  auditId: z.string().nullable(),
});
export type StaffActionResult = z.infer<typeof StaffActionResult>;

/** Why an order is on the stuck list. */
export const StuckReason = z.enum([
  'merchant_no_answer',
  'kitchen_silent',
  'no_courier',
  'courier_lost',
  'not_closed',
  'dispute_open',
  'dispute_overdue',
  'ride_no_driver',
  'ride_driver_no_show',
  'ride_not_closed',
]);
export type StuckReason = z.infer<typeof StuckReason>;

/**
 * Which W3 money outcomes are switched on (read-only, for the Console to say "waits on Ali's decision"
 * before staff click, instead of only `money_rule_off` after). Booleans, the allowed dispute outcomes
 * (`void` is always allowed: it moves no money) and the support agent's refund limit.
 */
export const StaffOpsSwitches = z.object({
  disputeOutcomes: z.array(DisputeOutcomeKind),
  agentLimitIqd: Iqd.nonnegative(),
  courierLostRefund: z.boolean(),
  courierLostCharge: z.boolean(),
  freeCancel: z.boolean(),
  cookedFoodPayer: z.enum(['platform', 'merchant']),
  /** c6: Driver pays a kitchen's remake when no courier came within 10 min of «جاهز» (`MERCHANT_REMAKE_PAY`). */
  remakePay: z.boolean(),
});
export type StaffOpsSwitches = z.infer<typeof StaffOpsSwitches>;

export const StuckOrdersInput = z.object({ cityId: z.string().min(1), limit: z.number().int().min(1).max(500).default(200) });
export type StuckOrdersInput = z.infer<typeof StuckOrdersInput>;

export const StuckOrder = z.object({
  orderId: z.string(),
  ticket: z.string(),
  type: z.string(),
  state: OrderState,
  reason: StuckReason,
  /** When the order entered the state it is stuck in. */
  since: z.coerce.date(),
  minutes: z.number().int().nonnegative(),
  /** A platform failure (M-2): the customer may cancel free once that switch is on. */
  platformFailure: z.boolean(),
  totalIqd: Iqd.nonnegative(),
  paymentMethod: z.string(),
  /** The actions that apply to it now (`orders.ops.*` procedure names). */
  actions: z.array(z.enum(['cancel', 'markDelivered', 'close', 'courierLost', 'resolveDispute'])),
});
export type StuckOrder = z.infer<typeof StuckOrder>;

/** M-3 / M-4: the customer's cash standing (checkout and the wallet screen show it). */
export const CashStanding = z.object({
  /** Unpaid cancellation fees and short cash, as a positive amount; 0 when he owes nothing. */
  owedIqd: Iqd.nonnegative(),
  unpaidFees: z.number().int().nonnegative(),
  openCashOrders: z.number().int().nonnegative(),
  /** How many cash orders he may have open at once (null while the cap is switched off). */
  openCashLimit: z.number().int().positive().nullable(),
  /** Whether a new cash order would be accepted now, and if not why (the error code `orders.place` returns). */
  cashAllowed: z.boolean(),
  blockedBy: z.enum(['open_cash_orders_cap', 'cash_debt_blocked', 'prepay_required']).nullable(),
});
export type CashStanding = z.infer<typeof CashStanding>;
