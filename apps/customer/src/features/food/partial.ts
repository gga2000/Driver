import type { Order } from '@driver/contracts';
import type { CartLine } from './cart';

/**
 * BENCH-03: the kitchen has run out of some dishes and asks whether to send the rest. The lines it
 * can't make, named from the cart he built (the menu's words he saw), else the order's own text.
 */
export interface PartialAsk {
  missing: Array<{ id: string; name: string | null; qty: number }>;
  reducedTotalIqd: number;
  totalIqd: number;
  proposedAt: Date;
  deadline: Date;
}

export function partialAsk(o: Pick<Order, 'state' | 'partial' | 'lines' | 'totalIqd'>, cart: { lines: readonly Pick<CartLine, 'itemId' | 'name'>[] } | null): PartialAsk | null {
  if (o.state !== 'placed' || !o.partial) return null;
  const ids = new Set(o.partial.unavailableLineIds);
  const missing = o.lines
    .filter((l) => ids.has(l.id))
    .map((l) => ({ id: l.id, qty: Math.max(1, l.qty), name: (l.catalogItemId ? cart?.lines.find((c) => c.itemId === l.catalogItemId)?.name : null) ?? l.freeText ?? null }));
  return { missing, reducedTotalIqd: o.partial.reducedTotalIqd, totalIqd: o.totalIqd, proposedAt: o.partial.proposedAt, deadline: o.partial.deadline };
}

/** The heading's dish words: «بيبسي», «بيبسي وكباب», else null (the screen says «صنف من طلبك»). */
export function missingWords(ask: Pick<PartialAsk, 'missing'>): string | null {
  const names = ask.missing.map((m) => m.name);
  if (names.some((n) => !n)) return null;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} و${names[1]}`;
  return null;
}

/** Whole seconds left to answer, never below 0. */
export function secondsLeft(deadline: Date, now: number): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now) / 1000));
}

/** Iraqi count of seconds: «ثانية وحدة» · «ثانيتين» · «5 ثواني» · «45 ثانية». */
export function secondsKey(n: number): 'kitchen.partial_left_one' | 'kitchen.partial_left_two' | 'kitchen.partial_left_few' | 'kitchen.partial_left' {
  if (n === 1) return 'kitchen.partial_left_one';
  if (n === 2) return 'kitchen.partial_left_two';
  return n >= 3 && n <= 10 ? 'kitchen.partial_left_few' : 'kitchen.partial_left';
}
