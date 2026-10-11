import { useSyncExternalStore } from 'react';
import type { BasketLine, ProduceItem } from './model';
import { priceForWeight } from './weight';

/**
 * The produce basket: one stall's items and how much of each. Held on the phone until checkout; a
 * line for another stall starts a new basket (one courier, one stop), like the food cart.
 */
export interface BasketState {
  stallId: string | null;
  lines: BasketLine[];
}

const EMPTY: BasketState = { stallId: null, lines: [] };
let state: BasketState = EMPTY;
const listeners = new Set<() => void>();
function emit(next: BasketState) {
  state = next;
  listeners.forEach((l) => l());
}

export const basket = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Put `amount` (grams or pieces) of an item in, replacing what was there; 0 takes it out. */
  set(stallId: string, itemId: string, amount: number, note = '') {
    const base = state.stallId === stallId ? state.lines : [];
    const others = base.filter((l) => l.itemId !== itemId);
    const lines = amount > 0 ? [...others, { stallId, itemId, amount, note }] : others;
    emit({ stallId: lines.length ? stallId : null, lines });
  },
  clear() {
    emit(EMPTY);
  },
};

export function useBasket(): BasketState {
  return useSyncExternalStore(basket.subscribe, basket.get, basket.get);
}

/** What a line costs at the stall's price today (rounded the way cash is paid). */
export function lineIqd(item: ProduceItem, amount: number): number {
  return item.soldBy === 'kg' ? priceForWeight(item.priceIqd, amount) : item.priceIqd * amount;
}

/** The basket's estimate against a stall's items. */
export function basketIqd(lines: readonly BasketLine[], items: readonly ProduceItem[]): number {
  return lines.reduce((sum, l) => {
    const item = items.find((i) => i.id === l.itemId);
    return item ? sum + lineIqd(item, l.amount) : sum;
  }, 0);
}
