import { useEffect, useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import { parseAppearance, type Appearance } from './logic';

/** The حسابي light/dark choice, kept on this device (like the language and simple mode). */
export const APPEARANCE_KEY = 'driver.customer.appearance';

export interface AppearanceState {
  /** Read from storage (until then `auto`: the phone's setting, so nothing flips once it loads for most people). */
  loaded: boolean;
  choice: Appearance;
}

export function createAppearanceStore(store: KeyValueStorage) {
  let state: AppearanceState = { loaded: false, choice: 'auto' };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: AppearanceState) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    /** Reads the stored choice once; storage failing leaves it on `auto`. */
    load(): Promise<void> {
      if (state.loaded) return Promise.resolve();
      loading ??= store.getItem(APPEARANCE_KEY).then(
        (v) => emit({ loaded: true, choice: parseAppearance(v) }),
        () => emit({ loaded: true, choice: 'auto' }),
      );
      return loading;
    },
    async set(choice: Appearance): Promise<void> {
      emit({ loaded: true, choice });
      await store.setItem(APPEARANCE_KEY, choice).catch(() => undefined);
    },
  };
}

export const appearance = createAppearanceStore(platformStorage);

/** The choice and its setter (the حسابي switch). */
export function useAppearance(): AppearanceState & { set: (choice: Appearance) => Promise<void> } {
  const s = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot, appearance.getSnapshot);
  useEffect(() => {
    void appearance.load();
  }, []);
  return { ...s, set: appearance.set };
}
