import type { CartDish, CartDishGroup } from '@driver/contracts';

/**
 * A cart dish's size and extras as the customer picks them (Ali 2026-10-12): a pick-one group (a size)
 * holds one option, a pick-any group (extras) up to its max. Free of React so it can be tested; the
 * server checks and prices the same picks again.
 */
export type Picked = Record<string, string[]>;

export interface ChosenOption {
  groupId: string;
  optionId: string;
  nameAr: string;
  priceIqd: number;
}

/** One line on the cart page: a dish with its picks, and how many. */
export interface CartPick {
  key: string;
  dish: CartDish;
  choices: ChosenOption[];
  qty: number;
}

export const single = (g: CartDishGroup) => g.maxSelect === 1;
export const needed = (g: CartDishGroup) => Math.max(g.minSelect, g.required ? 1 : 0);

/** A required size starts on its first option on sale, so the sheet can add at once. */
export function startPicks(dish: CartDish): Picked {
  const out: Picked = {};
  for (const g of dish.groups) {
    const first = g.options.find((o) => o.available);
    out[g.id] = single(g) && needed(g) > 0 && first ? [first.id] : [];
  }
  return out;
}

export function toggle(dish: CartDish, picked: Picked, groupId: string, optionId: string): Picked {
  const g = dish.groups.find((x) => x.id === groupId);
  if (!g) return picked;
  const now = picked[groupId] ?? [];
  if (single(g)) return { ...picked, [groupId]: needed(g) > 0 || !now.includes(optionId) ? [optionId] : [] };
  if (now.includes(optionId)) return { ...picked, [groupId]: now.filter((x) => x !== optionId) };
  if (now.length >= g.maxSelect) return picked;
  return { ...picked, [groupId]: [...now, optionId] };
}

/** Every group within its min and max. */
export function picksOk(dish: CartDish, picked: Picked): boolean {
  return dish.groups.every((g) => {
    const n = (picked[g.id] ?? []).length;
    return n >= needed(g) && n <= g.maxSelect;
  });
}

/** The picks in the dish's own order (the size, then the extras as the owner listed them). */
export function chosen(dish: CartDish, picked: Picked): ChosenOption[] {
  return dish.groups.flatMap((g) => g.options.filter((o) => (picked[g.id] ?? []).includes(o.id)).map((o) => ({ groupId: g.id, optionId: o.id, nameAr: o.nameAr, priceIqd: o.priceIqd })));
}

export const unitPrice = (dish: CartDish, choices: readonly ChosenOption[]) => dish.priceIqd + choices.reduce((s, c) => s + c.priceIqd, 0);

export const pickKey = (dish: CartDish, choices: readonly ChosenOption[]) => `${dish.itemId}|${choices.map((c) => c.optionId).join(',')}`;

/** Adds one of a dish with these picks: the same picks again just count up. */
export function addPick(list: readonly CartPick[], dish: CartDish, choices: ChosenOption[], qty = 1): CartPick[] {
  const key = pickKey(dish, choices);
  return list.some((p) => p.key === key) ? list.map((p) => (p.key === key ? { ...p, qty: Math.min(20, p.qty + qty) } : p)) : [...list, { key, dish, choices, qty }];
}

export function setQty(list: readonly CartPick[], key: string, qty: number): CartPick[] {
  return qty <= 0 ? list.filter((p) => p.key !== key) : list.map((p) => (p.key === key ? { ...p, qty } : p));
}

/** «من 3,000» when a required size changes the price. */
export function priceFrom(dish: CartDish): { from: boolean; priceIqd: number } {
  const sizes = dish.groups.filter((g) => single(g) && needed(g) > 0);
  const lowest = sizes.reduce((s, g) => {
    const ps = g.options.filter((o) => o.available).map((o) => o.priceIqd);
    return s + (ps.length ? Math.min(...ps) : 0);
  }, 0);
  // «من» only when the sizes on sale cost different amounts.
  const from = sizes.some((g) => new Set(g.options.filter((o) => o.available).map((o) => o.priceIqd)).size > 1);
  return { from, priceIqd: dish.priceIqd + lowest };
}
