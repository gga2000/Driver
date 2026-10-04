'use client';

import { useSyncExternalStore } from 'react';
import { PREF_KEYS } from './prefs-keys';

export { PREF_KEYS };

/**
 * Per-viewer conveniences kept in localStorage (wrapped: private windows just forget): the theme
 * (light by default; dark for night shifts), the density (comfortable or compact) and whether the
 * sidebar is collapsed. The root layout's pre-paint script applies theme and density to <html>
 * before React loads, so a dark-theme reload never flashes cream.
 */

export type ThemePref = 'light' | 'dark';
export type DensityPref = 'comfortable' | 'compact';

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the attribute still changes for this visit */
  }
}

function attr(name: string): string | null {
  return typeof document === 'undefined' ? null : document.documentElement.getAttribute(name);
}

export function setTheme(theme: ThemePref) {
  document.documentElement.setAttribute('data-theme', theme);
  write(PREF_KEYS.theme, theme);
  for (const l of listeners) l();
}
export function setDensity(density: DensityPref) {
  document.documentElement.setAttribute('data-density', density);
  write(PREF_KEYS.density, density);
  for (const l of listeners) l();
}
export function setSidebarCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.setAttribute('data-sidebar', 'collapsed');
  else document.documentElement.removeAttribute('data-sidebar');
  write(PREF_KEYS.sidebar, collapsed ? 'collapsed' : 'open');
  for (const l of listeners) l();
}

export function useTheme(): ThemePref {
  return useSyncExternalStore(
    subscribe,
    () => (attr('data-theme') === 'dark' ? 'dark' : 'light'),
    () => 'light',
  );
}
export function useDensity(): DensityPref {
  return useSyncExternalStore(
    subscribe,
    () => (attr('data-density') === 'compact' ? 'compact' : 'comfortable'),
    () => 'comfortable',
  );
}
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => attr('data-sidebar') === 'collapsed',
    () => false,
  );
}

/** Read once (no subscription), e.g. for "seen" markers. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = typeof window === 'undefined' ? null : read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
export function writeJson(key: string, value: unknown) {
  write(key, JSON.stringify(value));
}
