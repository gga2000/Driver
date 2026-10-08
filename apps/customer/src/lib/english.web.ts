import { locales } from '@driver/i18n';

/**
 * English words on the website (speed w5, Ali 2026-10-08): almost everyone reads Arabic, so a
 * production build ships an empty English table (metro.config.js) and the words come as their own
 * small file only when someone picks English. Until they arrive (or if they can't, offline) the
 * Arabic shows, the same fallback as any missing key. Dev builds carry the full table already.
 */
const table = locales.en as Record<string, string>;
let ready = Object.keys(table).length > 0;
/** The load failed (offline): screens go on in Arabic rather than wait. */
let failed = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** Bumped whenever the English table changes, so screens drawn before it came draw again. */
let version = 0;

/** True once the words are in, or once loading them failed (so nothing waits forever). */
export const englishReady = (): boolean => ready || failed;

export const englishVersion = (): number => version;

export function onEnglish(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadEnglish(): Promise<void> {
  if (ready) return Promise.resolve();
  pending ??= import('@driver/i18n/en-words')
    .then((m: { default: Record<string, string> }) => {
      Object.assign(table, m.default);
      ready = true;
    })
    .catch(() => {
      failed = true; // offline: Arabic for now, tried again on the next pick or open
      pending = null;
    })
    .then(() => {
      version += 1;
      for (const l of listeners) l();
    });
  return pending;
}
