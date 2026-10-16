import { setDataSaverPref, type DataSaverPref } from '@driver/ui';
import { storage, type KeyValueStorage } from './storage';

/** The customer's low-data choice (account › low-data mode), `auto` by default. */
export const DATA_SAVER_KEY = 'driver.customer.data_saver';

function parse(v: string | null): DataSaverPref {
  return v === 'on' || v === 'off' ? v : 'auto';
}

let loaded: Promise<DataSaverPref> | null = null;

/** Reads the stored choice at start (maps program q2); storage failing leaves `auto`. */
export function loadDataSaverPref(store: KeyValueStorage = storage): Promise<DataSaverPref> {
  loaded = (async () => {
    const pref = parse(await store.getItem(DATA_SAVER_KEY).catch(() => null));
    setDataSaverPref(pref);
    return pref;
  })();
  return loaded;
}

/** Resolves once the stored choice is in place (so nothing reads the start-up `auto` by mistake). */
export function dataSaverLoaded(): Promise<DataSaverPref> {
  return loaded ?? loadDataSaverPref();
}

/** Set once the slow-network hint has been shown (speed g4): it never comes back. */
export const LITE_HINT_KEY = 'driver.customer.lite_hint_shown';

/**
 * Which slow-network hint to show, if any: `auto` (we already went light; offer «always»), `off` (the
 * person turned it off; offer to go light now), nothing when it's already on, not slow, or shown before.
 */
export function liteHintFor(pref: DataSaverPref, slow: boolean, shownBefore: boolean): 'auto' | 'off' | null {
  if (!slow || shownBefore || pref === 'on') return null;
  return pref;
}

export async function saveDataSaverPref(pref: DataSaverPref, store: KeyValueStorage = storage): Promise<void> {
  setDataSaverPref(pref);
  await store.setItem(DATA_SAVER_KEY, pref).catch(() => undefined);
}
