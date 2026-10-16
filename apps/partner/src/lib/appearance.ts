import { useSyncExternalStore } from 'react';
import { nightAt } from './sun-times';
import { storage, type KeyValueStorage } from './storage';

/**
 * The night look (idea n2): `auto` turns the app to the warm dark «ember» palette from sunset to sunrise
 * in Aziziyah, so a driver's screen doesn't glare in a dark car; `day` / `night` are his choice
 * (account tab). One timer for the next sunrise or sunset, no clock polling.
 */
export type AppearancePref = 'auto' | 'day' | 'night';
export const APPEARANCE_PREFS: readonly AppearancePref[] = ['auto', 'day', 'night'];
export const APPEARANCE_KEY = 'driver.partner.appearance';

interface AppearanceState {
  pref: AppearancePref;
  /** Dark outside now (sunset to sunrise), whatever the choice. */
  dark: boolean;
  /** The app shows its night look. */
  night: boolean;
  /** When `dark` next flips. */
  nextChange: Date;
}

export function nightFor(pref: AppearancePref, dark: boolean): boolean {
  return pref === 'night' || (pref === 'auto' && dark);
}

function compute(pref: AppearancePref, now: Date = new Date()): AppearanceState {
  const sky = nightAt(now);
  return { pref, dark: sky.night, night: nightFor(pref, sky.night), nextChange: sky.nextChange };
}

let state: AppearanceState = compute('auto');
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(next: AppearanceState) {
  const changed = next.night !== state.night || next.pref !== state.pref || next.dark !== state.dark;
  state = next;
  schedule();
  if (changed) for (const l of listeners) l();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (listeners.size === 0) return;
  // A few seconds past the change so the sky has really turned; capped so a sleeping phone re-checks.
  const wait = Math.min(Math.max(state.nextChange.getTime() - Date.now() + 5_000, 1_000), 6 * 3_600_000);
  timer = setTimeout(() => emit(compute(state.pref)), wait);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) emit(compute(state.pref));
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function setAppearancePref(pref: AppearancePref): void {
  emit(compute(pref));
}

export function useAppearance(): AppearanceState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

function parse(v: string | null): AppearancePref {
  return v === 'day' || v === 'night' ? v : 'auto';
}

export async function loadAppearancePref(store: KeyValueStorage = storage): Promise<AppearancePref> {
  const pref = parse(await store.getItem(APPEARANCE_KEY).catch(() => null));
  setAppearancePref(pref);
  return pref;
}

export async function saveAppearancePref(pref: AppearancePref, store: KeyValueStorage = storage): Promise<void> {
  setAppearancePref(pref);
  await store.setItem(APPEARANCE_KEY, pref).catch(() => undefined);
}
