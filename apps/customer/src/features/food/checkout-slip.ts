import { CHANGE_RULES, changeDue, type ChangeRules } from '@driver/contracts';
import { lineTotal, type CartLine, type CartState } from './cart';

/**
 * Checkout v2 (after-order design c1–c12): the pure parts of the two-step checkout and its «الوصل»
 * slip. No money is decided here: every amount is the cart's menu price or the server's quote, and
 * the change rule is the shared `CHANGE_RULES` the server checks with.
 */

/** The two steps: where/when/how you pay, then the slip you confirm. */
export type CheckoutStep = 1 | 2;

/** A dish on the slip: «لفة تكة · سارة  3,000». */
export interface SlipDish {
  key: string;
  name: string;
  qty: number;
  who: string | null;
  amountIqd: number;
}

/** Each cart line once, at its menu price, with who it is for (only when the basket is shared). */
export function slipDishes(cart: Pick<CartState, 'lines'>, whoOf: (line: CartLine) => string | null): SlipDish[] {
  return cart.lines.map((l) => ({ key: l.key, name: l.name, qty: l.qty, who: whoOf(l), amountIqd: lineTotal(l) }));
}

/**
 * What the change line under «راح أدفع بـ» says (c5):
 * - `exact`: he pays the exact amount.
 * - `change`: the courier brings the change, or it becomes wallet credit if he has none.
 * - `cash_only`: the change is above the wallet cap (25,000), so it must come back in cash.
 */
export type ChangeNote = { kind: 'exact' } | { kind: 'change'; changeIqd: number } | { kind: 'cash_only'; changeIqd: number };

export function changeNote(tenderIqd: number, totalIqd: number, rules: Pick<ChangeRules, 'maxIqd'> = CHANGE_RULES): ChangeNote {
  const change = changeDue(tenderIqd, totalIqd);
  if (change === 0) return { kind: 'exact' };
  return change > rules.maxIqd ? { kind: 'cash_only', changeIqd: change } : { kind: 'change', changeIqd: change };
}

/** One row of the calm price-change sheet (c12): the old and new line price, or gone. */
export interface PriceChangeRow {
  key: string;
  name: string;
  oldIqd: number;
  /** null: the dish (or one of its choices) ran out and left the basket. */
  newIqd: number | null;
}

/**
 * Old and new side by side after the menu moved under a basket: every line whose price changed,
 * and every line that left. Lines are matched by their cart key (reconcile keeps it).
 */
export function priceChanges(before: readonly CartLine[], after: readonly CartLine[]): PriceChangeRow[] {
  const next = new Map(after.map((l) => [l.key, l]));
  const rows: PriceChangeRow[] = [];
  for (const l of before) {
    const now = next.get(l.key);
    const oldIqd = lineTotal(l);
    if (!now) rows.push({ key: l.key, name: l.name, oldIqd, newIqd: null });
    else if (lineTotal(now) !== oldIqd) rows.push({ key: l.key, name: l.name, oldIqd, newIqd: lineTotal(now) });
  }
  return rows;
}

/** The time chips (c9): «هسة» when the kitchen is open, then the first `n` slots; the rest open on «وقت ثاني». */
export function quickSlots<T>(slots: readonly T[], n = 2): T[] {
  return slots.slice(0, Math.max(0, n));
}
