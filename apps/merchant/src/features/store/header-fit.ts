/**
 * The tablet status bar (m1a, 2026-10-06): the store, the open switch, the status chips and the money
 * line share one row only while they all fit at their natural widths; otherwise the chips move to a
 * second row and wrap there. Nothing is ever clipped or scrolled out of sight ("زحمة؟" cut to one
 * letter, the printer warning pushed off the left edge). Free of React Native so it is unit-tested.
 */

export interface HeaderWidths {
  /** The bar's own width (onLayout), padding included. */
  row: number;
  /** Horizontal padding on each side. */
  padding: number;
  /** Gap between items. */
  gap: number;
  /** Items that always sit on the first row (store name, open switch, money line). */
  fixed: readonly number[];
  /** Each status chip at its natural width. */
  chips: readonly number[];
}

/** Whether the chips fit on the first row between the switch and the money line. */
export function chipsFitInline(w: HeaderWidths): boolean {
  if (w.row <= 0) return true;
  if (w.chips.length === 0) return true;
  const items = w.fixed.length + w.chips.length;
  const needed = w.fixed.reduce((s, x) => s + x, 0) + w.chips.reduce((s, x) => s + x, 0) + w.gap * (items - 1) + 2 * w.padding;
  return needed <= w.row;
}

/**
 * Day-one d04: the header's one alarm slot. `alerts` come most urgent first; the first takes the slot,
 * the rest go into «…» with everything else (printer, missed orders, the money line).
 */
export function headerSlot<T>(alerts: readonly T[]): { slot: T | null; rest: T[] } {
  return { slot: alerts[0] ?? null, rest: alerts.slice(1) };
}

/** «…» wears a dot while something inside it needs a look: a red item, or one with its own dot. */
export function menuNeedsLook(items: readonly { tone: string; dot?: boolean | undefined }[]): boolean {
  return items.some((a) => a.dot === true || a.tone === 'danger');
}
