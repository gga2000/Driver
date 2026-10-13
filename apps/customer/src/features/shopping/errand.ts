import { useSyncExternalStore } from 'react';
import { errandWontFetch, KnownShopName, type ErrandWontFetch } from '@driver/contracts';

/**
 * «دوّرلي» (Ali 2026-10-11: "the customer can type a list but it shouldn't be confined to food, they
 * can ask anything from any shop, even shops that are not registered with us"): the list a customer
 * writes for a shopper, item by item. Each item says what (words, a voice note or a photo of the old
 * one), how much, from where (any shop nearby, a shop in the app, or a shop he knows that is not in the
 * app, marked on the map), what to do if it is not there, and an optional top price. It is placed as
 * an `errand` order: the shopper buys with his own cash, photographs the receipt, and the customer pays
 * the receipt plus the fees at the door (the server's errand rules, ceiling and substitutions).
 */
export type ErrandUnit = 'piece' | 'box' | 'kg' | 'carton';
export const ERRAND_UNITS: readonly ErrandUnit[] = ['piece', 'box', 'kg', 'carton'];

export type IfMissing = 'call' | 'similar' | 'skip';
export const IF_MISSING: readonly IfMissing[] = ['call', 'similar', 'skip'];

export type ErrandWhere =
  /** Any shop nearby: the shopper picks the closest that has it. */
  | { kind: 'near' }
  /** A shop in the app. */
  | { kind: 'app'; shopId: string; name: string }
  /** A shop the customer knows that is not in the app, by name, with a pin when he marked one. */
  | { kind: 'known'; name: string; pin: { lat: number; lng: number } | null };

export interface ErrandItem {
  id: string;
  what: string;
  /** A photo of the thing (the old charger, the medicine box), a local file until the order uploads it. */
  photoUri: string | null;
  /** A voice note instead of (or with) the words, a local file until the order uploads it. */
  voice: { uri: string; durationMs: number } | null;
  qty: number;
  unit: ErrandUnit;
  where: ErrandWhere;
  ifMissing: IfMissing;
  /** The most he will pay for this item, null for no limit. */
  maxIqd: number | null;
}

export function blankItem(): ErrandItem {
  return {
    id: `it_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    what: '',
    photoUri: null,
    voice: null,
    qty: 1,
    unit: 'piece',
    where: { kind: 'near' },
    ifMissing: 'call',
    maxIqd: null,
  };
}

/** What the shopper won't fetch that the item's words name (Ali 2026-10-12: medicines, cigarettes, gas), or null. */
export function wontFetch(item: Pick<ErrandItem, 'what'>): ErrandWontFetch | null {
  return errandWontFetch(item.what);
}

/** An item is ready when it says what is wanted in some way, and a shop he knows has a name. */
export function itemReady(item: ErrandItem): boolean {
  const said = item.what.trim().length > 0 || item.voice != null || item.photoUri != null;
  const whereOk = item.where.kind !== 'known' || KnownShopName.safeParse(item.where.name).success;
  return said && whereOk && item.qty > 0;
}

/** The shops the shopper will visit: one stop per named shop, one for everything «أي محل قريب». */
export function stopsOf(items: readonly ErrandItem[]): number {
  const named = new Set(
    items
      .filter((i) => i.where.kind !== 'near')
      .map((i) =>
        i.where.kind === 'app'
          ? `a:${i.where.shopId}`
          : `k:${(i.where as { name: string }).name.trim()}`,
      ),
  );
  return named.size + (items.some((i) => i.where.kind === 'near') ? 1 : 0);
}

export interface ErrandDraft {
  items: ErrandItem[];
  /** The whole list's ceiling: over it the shopper calls before buying (`errand.ceiling`). */
  ceilingIqd: number | null;
}

let draft: ErrandDraft = { items: [], ceilingIqd: null };
const listeners = new Set<() => void>();
function emit(next: ErrandDraft) {
  draft = next;
  listeners.forEach((l) => l());
}

export const errandDraft = {
  get: () => draft,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  save(item: ErrandItem) {
    const exists = draft.items.some((i) => i.id === item.id);
    emit({
      ...draft,
      items: exists
        ? draft.items.map((i) => (i.id === item.id ? item : i))
        : [...draft.items, item],
    });
  },
  remove(id: string) {
    emit({ ...draft, items: draft.items.filter((i) => i.id !== id) });
  },
  setCeiling(ceilingIqd: number | null) {
    emit({ ...draft, ceilingIqd });
  },
  clear() {
    emit({ items: [], ceilingIqd: null });
  },
};

export function useErrandDraft(): ErrandDraft {
  return useSyncExternalStore(errandDraft.subscribe, errandDraft.get, errandDraft.get);
}

/** A pin waiting for the item sheet that asked for it (the map screen sets it, the sheet takes it). */
let pendingPin: { lat: number; lng: number } | null = null;
export const shopPin = {
  put(p: { lat: number; lng: number }) {
    pendingPin = p;
  },
  take(): { lat: number; lng: number } | null {
    const p = pendingPin;
    pendingPin = null;
    return p;
  },
};
