import { setDataSaverPref, type DataSaverPref } from '@driver/ui';
import { storage, type KeyValueStorage } from './storage';

/** The driver's low-data choice (account tab), `auto` by default. */
export const DATA_SAVER_KEY = 'driver.partner.data_saver';

function parse(v: string | null): DataSaverPref {
  return v === 'on' || v === 'off' ? v : 'auto';
}

/** Reads the stored choice at start (maps program q2); storage failing leaves `auto`. */
export async function loadDataSaverPref(store: KeyValueStorage = storage): Promise<DataSaverPref> {
  const pref = parse(await store.getItem(DATA_SAVER_KEY).catch(() => null));
  setDataSaverPref(pref);
  return pref;
}

export async function saveDataSaverPref(pref: DataSaverPref, store: KeyValueStorage = storage): Promise<void> {
  setDataSaverPref(pref);
  await store.setItem(DATA_SAVER_KEY, pref).catch(() => undefined);
}
