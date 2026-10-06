import { z } from 'zod';
import type { OrderState } from './order.js';

/**
 * Household spending (joy w4 «بيتنا», domain §12). A household spending limit, not a money rule:
 * prices, fees, points and ledger postings are untouched. The server decides at `orders.place`; the
 * checkout uses the same function on the household view's numbers only to say «يروح للدافع يوافق».
 */
export const HOUSEHOLD_RULES = {
  /** A held order waits this long for the payer's answer, then is cancelled free («ما جاوب»). */
  approvalWaitMin: 30,
  /** Budget presets the member editor offers (دينار a month). */
  budgetPresetsIqd: [50_000, 100_000, 150_000] as const,
  /** Per-order limit presets (دينار). */
  limitPresetsIqd: [10_000, 25_000, 50_000] as const,
  /** «شهرك» looks back at most this many months. */
  monthsBack: 12,
} as const;

/** Why an order on the household wallet goes to the payer first. */
export const HouseholdApprovalReason = z.enum(['order_limit', 'month_budget', 'both']);
export type HouseholdApprovalReason = z.infer<typeof HouseholdApprovalReason>;

export interface HouseholdSpendInput {
  role: 'payer' | 'orderer' | 'member';
  /** Per-order limit; null = none. */
  orderLimitIqd: number | null;
  /** Monthly budget; null = none. */
  monthlyBudgetIqd: number | null;
  /** What the member already spent on the household wallet this Baghdad month (open orders included). */
  monthSpentIqd: number;
  /** This order's total. */
  totalIqd: number;
}

/**
 * Null when the order goes straight to the kitchen; otherwise why it waits for the payer. Payers are
 * never limited; a limit or budget is reached, not crossed, at exactly its amount.
 */
export function householdApproval(i: HouseholdSpendInput): HouseholdApprovalReason | null {
  if (i.role === 'payer') return null;
  const overOrder = i.orderLimitIqd !== null && i.totalIqd > i.orderLimitIqd;
  const overMonth = i.monthlyBudgetIqd !== null && i.monthSpentIqd + i.totalIqd > i.monthlyBudgetIqd;
  if (overOrder && overMonth) return 'both';
  if (overOrder) return 'order_limit';
  if (overMonth) return 'month_budget';
  return null;
}

/** A calendar month, `YYYY-MM`. */
export const MonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export type MonthKey = z.infer<typeof MonthKey>;

/** Baghdad is UTC+3 all year (no DST). */
const BAGHDAD_OFFSET_MS = 3 * 3_600_000;

/** The Baghdad calendar month an instant falls in. */
export function baghdadMonth(at: Date): MonthKey {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 7);
}

/** `[from, to)` of a Baghdad month, as instants. */
export function baghdadMonthRange(month: MonthKey): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1) - BAGHDAD_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) - BAGHDAD_OFFSET_MS) };
}

/** The month `n` months away (negative = earlier). */
export function shiftMonth(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** The Baghdad day of the month (1–31) of an instant. */
export function baghdadDayOfMonth(at: Date): number {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).getUTCDate();
}

/** The Baghdad hour (0–23) of an instant. */
export function baghdadHour(at: Date): number {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).getUTCHours();
}

/** 1–12 of a month key (for «أيلول» and friends: `time.month_<n>`). */
export function monthNumber(month: MonthKey): number {
  return Number(month.slice(5, 7));
}

/** Orders that never cost the household anything: refused, cancelled, failed or fully refunded. */
export const HOUSEHOLD_SPEND_EXCLUDED: readonly OrderState[] = ['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'failed', 'refunded'];

/** The order fields the month's spend reads. */
export interface HouseholdSpendOrder {
  ordererId: string;
  householdOrgId: string | null;
  totalIqd: number;
  state: OrderState;
}

/**
 * What one member spent on one household's wallet among `orders` (the caller passes one Baghdad
 * month): every order on that wallet that was not refused or cancelled, waiting ones included — so two
 * orders placed together can't both slip under the budget.
 */
export function householdMonthSpend(orders: readonly HouseholdSpendOrder[], householdId: string, personId: string): number {
  return orders.filter((o) => o.householdOrgId === householdId && o.ordererId === personId && !HOUSEHOLD_SPEND_EXCLUDED.includes(o.state)).reduce((s, o) => s + o.totalIqd, 0);
}
