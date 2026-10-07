import { useEffect, useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * «الوضع البسيط» (ride idea v2, Ali voted yes): bigger text, fewer choices and one big «رجعني للبيت»,
 * for our elders. Turned on from the account page; kept on this device, and kept through a sign-out
 * like the language (it is how this phone reads, whoever signs in next is usually the same person).
 *
 * Home switches to the simple home with one line: in `app/(tabs)/index.tsx`, put
 *
 *     <SimpleHomeRedirect />
 *
 * (from `@/features/simple/SimpleHome`) anywhere in the returned tree. It renders nothing and, when
 * the setting is on and someone is signed in, replaces home with `/simple`. The ride screens read
 * `useSimpleMode().on` themselves (the choose and live screens' `simple` presentation).
 */
export const SIMPLE_MODE_KEY = 'driver.customer.simple_mode';

export interface SimpleModeState {
  /** Read from storage (until then `on` is false: nothing switches before we know). */
  loaded: boolean;
  on: boolean;
}

export function createSimpleModeStore(store: KeyValueStorage) {
  let state: SimpleModeState = { loaded: false, on: false };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: SimpleModeState) => {
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
    /** Reads the stored choice once; storage failing leaves it off. */
    load(): Promise<void> {
      if (state.loaded) return Promise.resolve();
      loading ??= store.getItem(SIMPLE_MODE_KEY).then(
        (v) => emit({ loaded: true, on: v === 'on' }),
        () => emit({ loaded: true, on: false }),
      );
      return loading;
    },
    async set(on: boolean): Promise<void> {
      emit({ loaded: true, on });
      await store.setItem(SIMPLE_MODE_KEY, on ? 'on' : 'off').catch(() => undefined);
    },
  };
}

export const simpleMode = createSimpleModeStore(platformStorage);

/** The simple-mode switch: `on`, whether it is known yet, and `set` (the account page's toggle). */
export function useSimpleMode(): SimpleModeState & { set: (on: boolean) => Promise<void> } {
  const s = useSyncExternalStore(
    simpleMode.subscribe,
    simpleMode.getSnapshot,
    simpleMode.getSnapshot,
  );
  useEffect(() => {
    void simpleMode.load();
  }, []);
  return { ...s, set: simpleMode.set };
}
