import { useEffect, useSyncExternalStore } from 'react';
import { foldArabic, type MenuItem } from '@driver/contracts';
import type { Selection } from '@/features/food/modifiers';
import { session } from '@/lib/session';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * «مثل آخر مرة» (Ali's Yes on q2, 2026-10-07): how a person takes their tea and coffee — سادة، وسط أو
 * حلو، with or without هيل, ice on the side — remembered on this phone and picked for them next time,
 * on any café's menu that offers the same choice. Only optional choices are filled in (a required one
 * is still the person's to make), and only with an option the shop offers today. Device-local, cleared
 * on sign-out; nothing goes to the server.
 */
export type TasteKind = 'sugar' | 'cardamom' | 'ice';
export type Taste = Partial<Record<TasteKind, string>>;

/** Which remembered choice a modifier group is, by its name («السكر», «الهيل», «الثلج»). */
export function tasteKindOf(groupName: string): TasteKind | null {
  const n = foldArabic(groupName);
  if (/سكر/.test(n)) return 'sugar';
  if (/هيل/.test(n)) return 'cardamom';
  if (/ثلج/.test(n)) return 'ice';
  return null;
}

/** The selection with the person's usual filled into empty optional single-choice groups; which groups it filled. */
export function withTaste(item: Pick<MenuItem, 'modifierGroups'>, selection: Selection, taste: Taste): { selection: Selection; filled: string[] } {
  const next: Selection = { ...selection };
  const filled: string[] = [];
  for (const g of item.modifierGroups) {
    const kind = tasteKindOf(g.name);
    if (!kind || g.required || g.max !== 1 || (next[g.id]?.length ?? 0) > 0) continue;
    const want = taste[kind];
    const m = want ? g.modifiers.find((x) => x.available && foldArabic(x.name) === want) : undefined;
    if (!m) continue;
    next[g.id] = [m.id];
    filled.push(g.id);
  }
  return { selection: next, filled };
}

/** What this add teaches: the option picked in each remembered group (an empty group teaches nothing). */
export function learnTaste(item: Pick<MenuItem, 'modifierGroups'>, selection: Selection, taste: Taste): Taste {
  const next: Taste = { ...taste };
  for (const g of item.modifierGroups) {
    const kind = tasteKindOf(g.name);
    const id = selection[g.id]?.[0];
    const m = id ? g.modifiers.find((x) => x.id === id) : undefined;
    if (kind && m) next[kind] = foldArabic(m.name);
  }
  return next;
}

const KEY = 'driver.taste';

export function createTasteStore(store: KeyValueStorage) {
  let taste: Taste = {};
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: Taste) => {
    taste = next;
    for (const l of listeners) l();
    void store.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  };
  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => taste,
    load(): Promise<void> {
      loading ??= (async () => {
        try {
          const raw = await store.getItem(KEY);
          const parsed: unknown = raw ? JSON.parse(raw) : {};
          const out: Taste = {};
          if (parsed && typeof parsed === 'object') {
            for (const k of ['sugar', 'cardamom', 'ice'] as const) {
              const v = (parsed as Record<string, unknown>)[k];
              if (typeof v === 'string') out[k] = v;
            }
          }
          taste = out;
        } catch {
          taste = {};
        }
        for (const l of listeners) l();
      })();
      return loading;
    },
    learn(item: Pick<MenuItem, 'modifierGroups'>, selection: Selection) {
      const next = learnTaste(item, selection, taste);
      if (JSON.stringify(next) !== JSON.stringify(taste)) emit(next);
    },
    reset() {
      emit({});
    },
  };
}

export const tasteStore = createTasteStore(platformStorage);
session.onSignOut(() => tasteStore.reset());

export function useTaste(): Taste {
  useEffect(() => {
    void tasteStore.load();
  }, []);
  return useSyncExternalStore(tasteStore.subscribe, tasteStore.getSnapshot, tasteStore.getSnapshot);
}
