import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * Wallet top-up with cash (money §4 channel 3, domain §12) until digital rails land: the customer
 * asks for an amount and gets a 6-digit code (and a QR of it); a field-ops agent (Partner app, Ops
 * mode) or the courier carrying the customer's next order counts the cash, enters the code and
 * confirms. The ledger then credits the wallet (`credit_issued`, memo `topup:<channel>:<reference>`),
 * once: codes are single-use, expire after 24 h, and a customer has daily limits. ZainCash plugs in
 * later behind the API's `TopUpRailsPort`.
 */

export const TOPUP_RULES = {
  minIqd: 5_000,
  maxIqd: 100_000,
  stepIqd: 1_000,
  /** Requested + confirmed per customer per local day. */
  dailyMaxIqd: 200_000,
  dailyMaxRequests: 5,
  codeTtlHours: 24,
} as const;

export const TopUpState = z.enum(['pending', 'confirmed', 'expired', 'cancelled']);
export type TopUpState = z.infer<typeof TopUpState>;

export const TopUpChannel = z.enum(['ops_agent', 'courier', 'zaincash']);
export type TopUpChannel = z.infer<typeof TopUpChannel>;

export const RequestTopUpInput = z.object({ amountIqd: Iqd.min(TOPUP_RULES.minIqd).max(TOPUP_RULES.maxIqd) });
export type RequestTopUpInput = z.infer<typeof RequestTopUpInput>;

/** The customer's view of one top-up request. */
export const TopUpView = z.object({
  topUpId: z.string(),
  amountIqd: Iqd,
  /** Six digits, read out or shown to the agent / courier. */
  code: z.string().regex(/^\d{6}$/),
  /** What the QR encodes (`DRVTU:<code>`); scanners strip the prefix. */
  qrPayload: z.string(),
  state: TopUpState,
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  confirmedAt: z.coerce.date().nullable(),
  channel: TopUpChannel.nullable(),
  /** Settlement reference on the receipt (T-XXXX-XXXX) once confirmed. */
  reference: z.string().nullable(),
  /** What is left of today's limit after this request. */
  dailyRemainingIqd: Iqd,
});
export type TopUpView = z.infer<typeof TopUpView>;

export const TopUpStatusInput = z.object({ topUpId: z.string().min(1).optional() });
export type TopUpStatusInput = z.infer<typeof TopUpStatusInput>;

/** `DRVTU:123456` (or a bare code) → `123456`. */
export const TopUpCode = z
  .string()
  .trim()
  .transform((s) => s.replace(/^DRVTU:/i, '').replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/));

export const TopUpLookupInput = z.object({ code: TopUpCode });
export type TopUpLookupInput = z.input<typeof TopUpLookupInput>;

/** What the agent / courier sees before confirming. */
export const TopUpLookupView = z.object({
  topUpId: z.string(),
  amountIqd: Iqd,
  state: TopUpState,
  expiresAt: z.coerce.date(),
  /** The customer's first name when he set one (vault read, logged), else null. */
  customerName: z.string().nullable(),
  customerPhoneMasked: z.string().nullable(),
});
export type TopUpLookupView = z.infer<typeof TopUpLookupView>;

export const ConfirmTopUpInput = z.object({
  code: TopUpCode,
  /** Cash counted in hand; must equal the requested amount (`topup_amount_mismatch`). */
  amountIqd: Iqd.positive(),
  idempotencyKey: z.string().min(8).max(80).optional(),
});
export type ConfirmTopUpInput = z.input<typeof ConfirmTopUpInput>;

export const TopUpConfirmation = z.object({
  topUpId: z.string(),
  amountIqd: Iqd,
  reference: z.string(),
  channel: TopUpChannel,
  confirmedAt: z.coerce.date(),
  /** The customer's wallet balance after the credit. */
  walletBalanceIqd: Iqd,
  customerName: z.string().nullable(),
  customerPhoneMasked: z.string().nullable(),
});
export type TopUpConfirmation = z.infer<typeof TopUpConfirmation>;

/** What the API supplies to the wallet / ops / partner routers (implemented by `modules/topups`). */
export interface TopUpPort {
  request(actor: Actor, input: RequestTopUpInput): Promise<TopUpView>;
  /** One request by id, else the caller's latest (null when he never asked). */
  status(actor: Actor, input: TopUpStatusInput): Promise<TopUpView | null>;
  lookup(actor: Actor, input: z.infer<typeof TopUpLookupInput>, channel: 'ops_agent' | 'courier'): Promise<TopUpLookupView>;
  confirm(actor: Actor, input: z.infer<typeof ConfirmTopUpInput>, channel: 'ops_agent' | 'courier'): Promise<TopUpConfirmation>;
}
