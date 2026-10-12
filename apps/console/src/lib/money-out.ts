import { AZIZIYAH_MONEY_RULES, type PayoutChannel } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * Money out on the finance desk (`finance.payMerchant`, `finance.payDriver`, `finance.adjust`): the
 * forms' checks and labels. Pure; every amount the forms start from comes from the server (what a
 * restaurant is owed, what the company owes a driver), and the server checks every limit again.
 */

/** Who may pay out or correct the ledger (`FINANCE_MONEY_OUT_ROLES`). */
export const MONEY_OUT_ROLES = ['finance'] as const;

export const MERCHANT_CHANNELS: readonly Exclude<PayoutChannel, 'agent'>[] = ['zaincash', 'bank', 'ops_round'];
export const DRIVER_CHANNELS: readonly PayoutChannel[] = ['zaincash', 'agent', 'ops_round', 'bank'];

export const CHANNEL_KEY: Record<PayoutChannel, MessageKey> = {
  zaincash: 'console.pay_channel_zaincash',
  agent: 'console.pay_channel_agent',
  ops_round: 'console.pay_channel_ops_round',
  bank: 'console.pay_channel_bank',
};

/** What the company owes a driver right now: his earnings net of the cash in his hand, never below 0. */
export function driverPayable(v: { cashBalanceIqd: number; earningsBalanceIqd: number }): number {
  return Math.max(0, v.cashBalanceIqd + v.earningsBalanceIqd);
}

/** The amount field: whole dinars, more than 0, not more than is owed. */
export function payAmountProblem(amountIqd: number, maxIqd: number): 'empty' | 'too_much' | null {
  if (!Number.isFinite(amountIqd) || amountIqd <= 0) return 'empty';
  if (amountIqd > maxIqd) return 'too_much';
  return null;
}

/** One key per opened form: a double click or a retry is one payout (it fixes the settlement reference). */
export function payKey(kind: 'merchant' | 'driver' | 'adjust', id: string, openedAt: number, rand: () => number = Math.random): string {
  return `console-pay:${kind}:${id}:${openedAt.toString(36)}:${Math.floor(rand() * 1e9).toString(36)}`.slice(0, 128);
}

/** The kinds of money account a correction may touch, as the form offers them. */
export const ACCOUNT_KINDS = ['platform', 'bank', 'driver', 'cash', 'merchant_cash', 'customer'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KEY: Record<AccountKind, MessageKey> = {
  platform: 'console.adj_acct_platform',
  bank: 'console.adj_acct_bank',
  driver: 'console.adj_acct_driver',
  cash: 'console.adj_acct_cash',
  merchant_cash: 'console.adj_acct_merchant_cash',
  customer: 'console.adj_acct_customer',
};

/** `platform` and `bank` stand alone; the others need whose account it is. */
export function needsOwner(kind: AccountKind): boolean {
  return kind !== 'platform' && kind !== 'bank';
}

/** The ledger account id, or null while the owner's id is missing or not an id. */
export function accountId(kind: AccountKind, owner: string): string | null {
  if (!needsOwner(kind)) return kind;
  const id = owner.trim();
  return /^[^:\s]+$/.test(id) ? `${kind}:${id}` : null;
}

export interface AdjustDraft {
  from: string | null;
  to: string | null;
  amountIqd: number;
  reason: string;
  incidentId: string;
}

/** What still keeps the correction from being sent (the server checks all of it again). */
export function adjustProblem(d: AdjustDraft): 'accounts' | 'same' | 'amount' | 'reason' | 'incident' | null {
  if (!d.from || !d.to) return 'accounts';
  if (d.from === d.to) return 'same';
  if (!Number.isInteger(d.amountIqd) || d.amountIqd <= 0) return 'amount';
  if (d.reason.trim().length < 5) return 'reason';
  if (!d.incidentId.trim()) return 'incident';
  return null;
}

/** Above this a correction waits for a second finance person (`MoneyRules.adjustments.secondApproverAboveIqd`). */
export const SECOND_OK_ABOVE_IQD = AZIZIYAH_MONEY_RULES.adjustments.secondApproverAboveIqd;
