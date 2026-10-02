import { z } from 'zod';
import { Currency, Iqd } from './common.js';

export const LedgerEventType = z.enum([
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
  'adjustment',
]);
export type LedgerEventType = z.infer<typeof LedgerEventType>;

/**
 * Account ids are typed strings. Balance = Σ(to) − Σ(from).
 * - `platform`            the platform's own position (retained earnings)
 * - `driver:<id>`         earnings the platform owes a driver
 * - `cash:<driverId>`     cash physically held by a driver (credit cap applies here)
 * - `merchant:<id>`       what the platform owes a merchant
 * - `customer:<id>`       a customer wallet; negative = net paid in cash
 * - `bank`                the outside world for payouts (bank transfer, Zain Cash)
 */
export const AccountId = z
  .string()
  .regex(/^(platform|bank|driver:[^:]+|merchant:[^:]+|customer:[^:]+|cash:[^:]+)$/);
export type AccountId = z.infer<typeof AccountId>;

/**
 * Immutable money event. Double-entry: `amount` leaves `fromAccount` and enters `toAccount`.
 * Sum of all events is therefore always zero per invariant.
 */
export const LedgerEvent = z.object({
  id: z.string(),
  type: LedgerEventType,
  amount: Iqd.positive(),
  currency: Currency,
  fromAccount: AccountId,
  toAccount: AccountId,
  tripId: z.string().optional(),
  routeId: z.string().optional(),
  /** Device-side time, may precede recordedAt for offline events. */
  occurredAt: z.coerce.date(),
  recordedAt: z.coerce.date(),
  /** Idempotency key from the client action queue. */
  idempotencyKey: z.string().optional(),
  memo: z.string().optional(),
});
export type LedgerEvent = z.infer<typeof LedgerEvent>;
