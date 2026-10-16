import type { MenuItem } from '@driver/contracts';

/**
 * «شنو باقي اليوم؟» (Ali, 2026-10-07: "when there are more than 3 items sold out [the customer can] check
 * what is left"): once a kitchen has this many dishes marked «خلص اليوم», its menu offers a switch that
 * shows only what can still be ordered.
 */
export const WHATS_LEFT_FROM = 4;

interface Section {
  readonly items: readonly MenuItem[];
}

/** How many dishes are sold out today, and how many can still be ordered now. */
export function leftToday(categories: readonly Section[]): { soldOut: number; left: number } {
  let soldOut = 0;
  let left = 0;
  for (const c of categories)
    for (const i of c.items) {
      if (i.available) left += 1;
      else if (i.unavailableReason === 'sold_out') soldOut += 1;
    }
  return { soldOut, left };
}

/** The menu with only what can be ordered now; a section left with nothing goes too. */
export function onlyLeft<C extends Section>(categories: readonly C[]): C[] {
  return categories.map((c) => ({ ...c, items: c.items.filter((i) => i.available) })).filter((c) => c.items.length > 0);
}
