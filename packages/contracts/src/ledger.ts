import { z } from 'zod';
import { Currency, Iqd } from './common.js';

/** Money event types: domain §5 plus the 2026-10-03 amendments (merchant cash account, debts, rounding, cash refunds). */
export const MONEY_LEDGER_TYPES = [
  'cash_collected',
  'commission_accrued',
  'merchant_payable',
  'driver_settlement',
  'merchant_payout',
  'refund',
  'credit_issued',
  'cancellation_fee',
  'promo_funded',
  'seat_premium',
  'subscription_charge',
  'subscription_proration',
  'late_penalty_driver',
  'late_penalty_rider_credit',
  'departure_cancel_fee',
  'errand_cost_actual',
  'errand_fee',
  'tip',
  'parcel_fee',
  'adjustment',
  'merchant_paid_by_courier',
  'merchant_settlement_requested',
  'debt_settled',
  'cash_rounding_credit',
  'refund_cash_delivered',
  // M2 Step 6: named lines the posting groups need (money spec §2–3, edge-case G-86/88/91)
  'service_fee',
  'delivery_fee',
  'fare',
  'driver_incentive',
  'driver_payout',
  'rounding_residue',
  // Phase 3 "الخردة علينا" (2026-10-05): the courier had no change, so the rest of the customer's note
  // went to his wallet ("باقي الكاش"). Kept apart from `cash_rounding_credit` (the 0–249 rounding change).
  'cash_change_to_wallet',
] as const;

/** Points event types (domain §5). Points never create money. */
export const POINTS_LEDGER_TYPES = [
  'points_earned',
  'points_pending',
  'points_claimed',
  'points_redeemed',
  'points_expired',
  'organizer_bonus',
  // edge-case decisions §1: referral 200 points per side after the referee's second qualifying order
  'referral_bonus',
] as const;

export const LedgerEventType = z.enum([...MONEY_LEDGER_TYPES, ...POINTS_LEDGER_TYPES]);
export type LedgerEventType = z.infer<typeof LedgerEventType>;

export const LedgerKind = z.enum(['money', 'points']);
export type LedgerKind = z.infer<typeof LedgerKind>;

const pointsSet: ReadonlySet<string> = new Set(POINTS_LEDGER_TYPES);

/** Which book an event type belongs to. The two books are balanced separately. */
export function kindOf(type: LedgerEventType): LedgerKind {
  return pointsSet.has(type) ? 'points' : 'money';
}

/**
 * Account ids are typed strings. Balance = Σ(to) − Σ(from).
 *
 * Sign convention (claims view): a positive balance is value owed TO the holder (or earned by it);
 * a negative balance is value the holder owes. A courier who collected cash therefore has a
 * negative `cash:` balance until he hands it to the merchant (`merchant_paid_by_courier`) or the
 * company (`driver_settlement`); the company's real money (`bank`) is negative while it holds cash.
 * Money accounts:
 * - `platform`              the platform's own position (retained earnings)
 * - `driver:<id>`           earnings the platform owes a driver
 * - `cash:<driverId>`       cash physically held by a driver (credit cap applies here)
 * - `merchant:<id>`         what the platform owes a merchant
 * - `merchant_cash:<id>`    merchant cash account (edge-case §3): payable net of commission, settled by mode
 * - `customer:<id>`         a customer wallet; negative = net paid in cash
 * - `household:<orgId>`     a shared household wallet (domain §12)
 * - `bank`                  the company's real-money channels (ZainCash wallet, ops till, bank); negative = money held
 * - `rounding`              customer-total rounding residue (edge-case G-88)
 * - `promo:<promotionId>`   a promotion's budget line
 * Points accounts (never mixed with money):
 * - `points:<personId>`     a person's points balance
 * - `points_pending:<hash>` pending points keyed by phone hash until claimed
 * - `points_pool`           the platform's points liability pool
 */
export const AccountId = z
  .string()
  .regex(
    /^(platform|bank|rounding|points_pool|driver:[^:]+|merchant:[^:]+|merchant_cash:[^:]+|customer:[^:]+|household:[^:]+|cash:[^:]+|promo:[^:]+|points:[^:]+|points_pending:[^:]+)$/,
  );
export type AccountId = z.infer<typeof AccountId>;

export function isPointsAccount(account: string): boolean {
  return account === 'points_pool' || account.startsWith('points:') || account.startsWith('points_pending:');
}

/**
 * Immutable money or points event. Double-entry: `amount` leaves `fromAccount` and enters `toAccount`.
 * Sum of all events of one kind is therefore always zero per invariant.
 */
export const LedgerEvent = z.object({
  id: z.string(),
  kind: LedgerKind.default('money'),
  type: LedgerEventType,
  amount: Iqd.positive(),
  currency: Currency,
  fromAccount: AccountId,
  toAccount: AccountId,
  tripId: z.string().optional(),
  orderId: z.string().optional(),
  routeId: z.string().optional(),
  departureId: z.string().optional(),
  /** Balanced posting groups (one per closed order) share an id. */
  postingGroupId: z.string().optional(),
  /** Device-side time, may precede recordedAt for offline events. */
  occurredAt: z.coerce.date(),
  recordedAt: z.coerce.date(),
  /** Idempotency key from the client action queue. */
  idempotencyKey: z.string().optional(),
  memo: z.string().optional(),
});
export type LedgerEvent = z.infer<typeof LedgerEvent>;
