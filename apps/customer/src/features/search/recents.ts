import { useEffect, useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import { pushRecent } from './logic';

const KEY = 'driver.customer.search.recent';

/** "بحثت عنها قبل": the last searches on this device (same tiny external-store pattern as `lib/profile.ts`). */
export function createRecentsStore(store: KeyValueStorage) {
  let recents: string[] = [];
  let loaded = false;
  const listeners = new Set<() => void>();
  const emit = (next: string[]) => {
    recents = next;
    for (const l of listeners) l();
    void store.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };
  return {
    getSnapshot: () => recents,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    async load() {
      if (loaded) return;
      loaded = true;
      try {
        const raw = await store.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          recents = parsed.filter((x): x is string => typeof x === 'string');
          for (const l of listeners) l();
        }
      } catch {
        /* a broken entry starts empty */
      }
    },
    add: (query: string) => emit(pushRecent(recents, query)),
    clear: () => emit([]),
  };
}

export const searchRecents = createRecentsStore(platformStorage);

export function useSearchRecents(): readonly string[] {
  useEffect(() => {
    void searchRecents.load();
  }, []);
  return useSyncExternalStore(searchRecents.subscribe, searchRecents.getSnapshot, searchRecents.getSnapshot);
}
