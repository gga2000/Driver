import { useEffect, useSyncExternalStore } from 'react';
import { session } from '@/lib/session';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * «فتحتها قبل» (discovery D-24): the last restaurants this device opened, newest first, for the search
 * start screen. Only ids and names (no order data), kept on the phone and cleared on sign-out.
 */
export interface ViewedRestaurant {
  id: string;
  name: string;
}

export const MAX_VIEWED = 3;
const KEY = 'driver.customer.search.viewed';

/** A visit on top; the same kitchen once; at most `max`. */
export function pushViewed(list: readonly ViewedRestaurant[], r: ViewedRestaurant, max = MAX_VIEWED): ViewedRestaurant[] {
  if (!r.id || !r.name) return [...list];
  return [{ id: r.id, name: r.name }, ...list.filter((x) => x.id !== r.id)].slice(0, max);
}

function parse(raw: string | null): ViewedRestaurant[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is ViewedRestaurant => !!x && typeof x === 'object' && typeof (x as ViewedRestaurant).id === 'string' && typeof (x as ViewedRestaurant).name === 'string').slice(0, MAX_VIEWED) : [];
  } catch {
    // A broken entry starts empty.
    return [];
  }
}

export function createViewedStore(store: KeyValueStorage) {
  let list: ViewedRestaurant[] = [];
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = (next: ViewedRestaurant[]) => {
    list = next;
    for (const l of listeners) l();
    void store.setItem(KEY, JSON.stringify(next)).catch(() => undefined); // best effort: the list is a convenience
  };
  return {
    getSnapshot: () => list,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    async load() {
      if (loaded) return;
      loaded = true;
      const raw = await store.getItem(KEY).catch(() => null);
      // A visit recorded while loading stays on top.
      list = [...list, ...parse(raw).filter((r) => !list.some((x) => x.id === r.id))].slice(0, MAX_VIEWED);
      for (const l of listeners) l();
    },
    add: (r: ViewedRestaurant) => emit(pushViewed(list, r)),
    clear: () => emit([]),
  };
}

export const viewedRestaurants = createViewedStore(platformStorage);
// Another person signing in on this device never sees what the last one opened.
session.onSignOut(() => viewedRestaurants.clear());

export function useViewedRestaurants(): readonly ViewedRestaurant[] {
  useEffect(() => {
    void viewedRestaurants.load();
  }, []);
  return useSyncExternalStore(viewedRestaurants.subscribe, viewedRestaurants.getSnapshot, viewedRestaurants.getSnapshot);
}

/** The restaurant screen calls this once it knows the kitchen's name. */
export function useRememberViewed(id: string | undefined, name: string | undefined) {
  useEffect(() => {
    if (id && name) void viewedRestaurants.load().then(() => viewedRestaurants.add({ id, name }));
  }, [id, name]);
}
