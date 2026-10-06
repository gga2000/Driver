/**
 * The cart's minimum-order strip (f11, UI/UX audit F-04): how far the basket is toward the
 * restaurant's minimum and what is left. Since J-D6 the minimum is a choice, not a wall: below it the
 * order can still go with the server's small-order fee, so the strip shows both paths. Display only —
 * the fee itself comes from the server (`orders.quote`, or the restaurant card for guests).
 */
export interface MinOrderProgress {
  /** Items so far (menu prices, before any deal — the server's rule). */
  doneIqd: number;
  /** What is left to reach the minimum. */
  shortIqd: number;
  /** 0–1, for the progress bar. */
  ratio: number;
}

/** Progress toward `minOrderIqd`; null once it is met or when the kitchen has no minimum. */
export function minOrderProgress(itemsIqd: number, minOrderIqd: number): MinOrderProgress | null {
  if (minOrderIqd <= 0 || itemsIqd >= minOrderIqd) return null;
  const done = Math.max(0, itemsIqd);
  return { doneIqd: done, shortIqd: minOrderIqd - done, ratio: Math.round((done / minOrderIqd) * 100) / 100 };
}
