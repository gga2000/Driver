import { useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from './storage';

/**
 * Device preferences of the merchant tablet/phone: which store it is working for, UI language, the
 * new-order sound and auto-print. Persisted per device (a tablet stays on its store across sign-ins
 * of different staff).
 */

export type AppLocale = 'ar-IQ' | 'en';

export interface PrefsState {
  loaded: boolean;
  /** The store (merchant org) this device works for; null until picked (or auto-picked). */
  storeId: string | null;
  locale: AppLocale;
  /** Loud repeating sound on new orders (on by default: a kitchen is noisy). */
  soundOn: boolean;
  /** Print each order as soon as it is accepted. */
  autoPrint: boolean;
  /** s6: tickets in bigger type, to read from across the kitchen. */
  bigText: boolean;
}

const KEY = 'driver.merchant.prefs';
const EMPTY: PrefsState = { loaded: false, storeId: null, locale: 'ar-IQ', soundOn: true, autoPrint: true, bigText: false };

export function parsePrefs(raw: string | null): Omit<PrefsState, 'loaded'> {
  let v: Partial<PrefsState> = {};
  try {
    if (raw) v = JSON.parse(raw) as Partial<PrefsState>;
  } catch {
    v = {};
  }
  return {
    storeId: typeof v.storeId === 'string' && v.storeId ? v.storeId : null,
    locale: v.locale === 'en' ? 'en' : 'ar-IQ',
    soundOn: v.soundOn !== false,
    autoPrint: v.autoPrint !== false,
    bigText: v.bigText === true,
  };
}

export function createPrefsStore(store: KeyValueStorage) {
  let state: PrefsState = EMPTY;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const emit = (next: PrefsState) => {
    state = next;
    for (const l of listeners) l();
  };
  const save = async (patch: Partial<Omit<PrefsState, 'loaded'>>) => {
    const next = { ...state, ...patch };
    emit(next);
    const { loaded: _loaded, ...persisted } = next;
    void _loaded;
    await store.setItem(KEY, JSON.stringify(persisted)).catch(() => {});
  };

  return {
    getSnapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    load(): Promise<void> {
      if (state.loaded) return Promise.resolve();
      loading ??= (async () => {
        let raw: string | null = null;
        try {
          raw = await store.getItem(KEY);
        } catch {
          raw = null;
        }
        emit({ loaded: true, ...parsePrefs(raw) });
      })();
      return loading;
    },
    setStore: (storeId: string | null) => save({ storeId }),
    setLocale: (locale: AppLocale) => save({ locale }),
    setSound: (soundOn: boolean) => save({ soundOn }),
    setAutoPrint: (autoPrint: boolean) => save({ autoPrint }),
    setBigText: (bigText: boolean) => save({ bigText }),
  };
}

export const prefs = createPrefsStore(platformStorage);

export function usePrefs(): PrefsState {
  return useSyncExternalStore(prefs.subscribe, prefs.getSnapshot, prefs.getSnapshot);
}
