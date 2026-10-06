import { useSyncExternalStore } from 'react';
import { subscribeSlow } from './slow';

/**
 * Low-data mode (maps program q2): on a slow connection — or when the person turns it on — the apps
 * show the drawn food art instead of downloading photos, the simple map instead of map tiles, and
 * refresh less often. `auto` follows the connection; `on` / `off` are the person's choice (stored by
 * each app, handed in with `setDataSaverPref`).
 */
export type DataSaverPref = 'auto' | 'on' | 'off';
export const DATA_SAVER_PREFS: readonly DataSaverPref[] = ['auto', 'on', 'off'];
/** Refreshes run this many times slower in low-data mode. */
export const LITE_REFRESH_FACTOR = 3;

/** Whether the apps should save data now. */
export function liteFor(pref: DataSaverPref, slow: boolean): boolean {
  return pref === 'on' || (pref === 'auto' && slow);
}

/** A refresh interval, slowed down in low-data mode. */
export function liteInterval(ms: number, lite: boolean): number {
  return lite ? ms * LITE_REFRESH_FACTOR : ms;
}

interface DataSaverState {
  pref: DataSaverPref;
  slow: boolean;
  lite: boolean;
}

let state: DataSaverState = { pref: 'auto', slow: false, lite: false };
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function set(patch: Partial<Pick<DataSaverState, 'pref' | 'slow'>>) {
  const next = { ...state, ...patch };
  next.lite = liteFor(next.pref, next.slow);
  if (next.pref === state.pref && next.slow === state.slow) return;
  state = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  unsubscribe ??= subscribeSlow((slow) => set({ slow }));
  return () => {
    listeners.delete(cb);
  };
}

/** The person's choice (the app loads it from its storage at start and on change). */
export function setDataSaverPref(pref: DataSaverPref): void {
  set({ pref });
}

/** `{ pref, slow, lite }`: the settings row shows why it is on. */
export function useDataSaver(): DataSaverState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** True when the apps should save data right now. */
export function useLiteMode(): boolean {
  return useDataSaver().lite;
}
