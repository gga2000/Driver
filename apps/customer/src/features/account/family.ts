import type { HouseholdMemberView, HouseholdView } from '@driver/contracts';
import { toWesternDigits } from '@/lib/phone';

/**
 * «بيتنا» (joy w4): the small pieces of the family hub that are logic, not layout. Amounts come from
 * the server; these only place them on a bar or read what a payer typed.
 */

/** A bullet bar: the spend as a share of the budget (the tick), clamped; null without a budget. */
export function budgetBar(spentIqd: number, budgetIqd: number | null): { fraction: number; over: boolean } | null {
  if (budgetIqd === null) return null;
  if (budgetIqd <= 0) return { fraction: spentIqd > 0 ? 1 : 0, over: spentIqd > 0 };
  return { fraction: Math.max(0, Math.min(1, spentIqd / budgetIqd)), over: spentIqd > budgetIqd };
}

/** Which chip a stored limit shows as: «بلا حد», one of the presets, or «غيره» with the typed amount. */
export function presetChoice(value: number | null, presets: readonly number[]): 'none' | 'other' | number {
  if (value === null) return 'none';
  return presets.includes(value) ? value : 'other';
}

/** What a payer typed as an amount («25,000», «٢٥٠٠٠», «25000») → دينار; null when empty or not a number. */
export function parseAmount(text: string): number | null {
  const digits = toWesternDigits(text).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/** The members whose month the viewer may see (the server sends null for the others). */
export function monthRows(members: readonly HouseholdMemberView[]): Array<HouseholdMemberView & { monthSpentIqd: number }> {
  return members.filter((m): m is HouseholdMemberView & { monthSpentIqd: number } => m.monthSpentIqd !== null);
}

/** The Baghdad calendar day of an order («7/10»), whatever the phone's zone. */
export function baghdadDayMonth(at: Date): { day: number; month: number } {
  const local = new Date(at.getTime() + 3 * 3_600_000);
  return { day: local.getUTCDate(), month: local.getUTCMonth() + 1 };
}

/** The household's (first) payer: who says yes to an order over a limit. */
export function payerOf(home: Pick<HouseholdView, 'members'>): HouseholdMemberView | null {
  return home.members.find((m) => m.role === 'payer') ?? null;
}
