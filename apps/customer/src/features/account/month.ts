import { baghdadDayOfMonth, baghdadMonth, monthNumber, shiftMonth, type MonthInsightsView, type MonthKey } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * «شهرك» (joy w6): which warm line the month gets, when the month-start card shows, and the month
 * stepper's bounds. Every figure is the server's; these only choose words and dates.
 */

/** The month-start card shows on these Baghdad days of a month (1st to 3rd). */
export const MONTH_CARD_DAYS = 3;
/** «جربت 3 مطاعم» earns the explorer line; «مطعم خالد صار مثل بيتك الثاني» needs 3 orders there. */
const EXPLORER_KITCHENS = 3;
const LOYAL_ORDERS = 3;

export type WarmLine = { key: MessageKey; params?: Record<string, string | number> };

/**
 * One warm line for the month, kind and never about how much was eaten (delight strategy "What not
 * to do"): travel home safely first, then discovering kitchens, a favourite place, what was saved,
 * and a thank-you otherwise. Null for an empty month (the page says so itself).
 */
export function warmLine(v: MonthInsightsView, amount: (iqd: number) => string): WarmLine | null {
  if (!v.hasActivity) return null;
  if (v.rajaaTrips > 0) return { key: 'month.line_traveller' };
  if (v.kitchens >= EXPLORER_KITCHENS) return { key: 'month.line_explorer', params: { n: v.kitchens } };
  if (v.topKitchen && v.topKitchen.orders >= LOYAL_ORDERS) return { key: 'month.line_loyal', params: { kitchen: v.topKitchen.name } };
  if (v.savedIqd > 0) return { key: 'month.line_saver', params: { amount: amount(v.savedIqd) } };
  return { key: 'month.line_thanks' };
}

/**
 * The month whose card is due now: last month, on the 1st to 3rd (Baghdad), unless this device
 * already showed it or today is a quiet day. Null otherwise.
 */
export function monthCardDue(now: Date, seenMonth: string | null, quiet: boolean): MonthKey | null {
  if (quiet || baghdadDayOfMonth(now) > MONTH_CARD_DAYS) return null;
  const last = shiftMonth(baghdadMonth(now), -1);
  return seenMonth === last ? null : last;
}

/** «أيلول 2026»: the month's name key and its year. */
export function monthLabel(month: MonthKey): { nameKey: MessageKey; year: string } {
  return { nameKey: `time.month_${monthNumber(month)}` as MessageKey, year: month.slice(0, 4) };
}

/** Where the stepper may go from `month` (never past this month, never before the earliest). */
export function monthSteps(month: MonthKey, earliest: MonthKey, current: MonthKey): { prev: MonthKey | null; next: MonthKey | null } {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return { prev: prev >= earliest ? prev : null, next: next <= current ? next : null };
}
