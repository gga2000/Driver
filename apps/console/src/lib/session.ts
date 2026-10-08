'use client';

import { useSyncExternalStore } from 'react';

/**
 * Console session: the token pair from identity.verifyOtp, kept in memory and mirrored to
 * localStorage so a reload stays signed in. Storage access is wrapped — private windows and
 * blocked storage just mean "signed out after reload".
 *
 * Refresh (CON-01): the access token lives 15 minutes, so the session renews itself through
 * `identity.refresh` — ahead of expiry (`getFreshAccessToken`) and once more on a 401 (auth link).
 * The API rotates refresh tokens and revokes the session when one is reused, and staff keep several
 * Console tabs open, so a refresh is single-flight in this tab AND across tabs: a Web Lock serialises
 * it, the tab that gets the lock second sees the rotated pair in storage and adopts it instead of
 * spending the old token, and a `storage` event keeps every tab's copy current.
 *
 * Trade-off kept for now: the refresh token sits in localStorage (K0c in the Console build plan
 * decides the httpOnly cookie).
 */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface TokenPairLike {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date | string;
  refreshExpiresAt: Date | string;
}

export type Refresher = (refreshToken: string) => Promise<TokenPairLike>;

/** Renew this long before the access token runs out. */
export const REFRESH_SKEW_MS = 60_000;

const KEY = 'driver.console.session';
const LOCK = 'driver.console.refresh';
let current: StoredSession | null | undefined; // undefined = not yet read from storage
let refresher: Refresher | null = null;
let inflight: Promise<boolean> | null = null;
/** Bumped on every sign-in/out so a refresh that started before can't bring a session back. */
let generation = 0;
let now: () => number = () => Date.now();
const listeners = new Set<() => void>();

function parse(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.accessToken !== 'string' || typeof v.refreshToken !== 'string') return null;
    if (typeof v.accessExpiresAt !== 'string' || typeof v.refreshExpiresAt !== 'string') return null;
    return { accessToken: v.accessToken, refreshToken: v.refreshToken, accessExpiresAt: v.accessExpiresAt, refreshExpiresAt: v.refreshExpiresAt };
  } catch {
    return null;
  }
}

function readStorage(): StoredSession | null {
  try {
    return typeof window === 'undefined' ? null : parse(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function read(): StoredSession | null {
  if (current !== undefined) return current;
  current = readStorage();
  return current;
}

function write(s: StoredSession | null) {
  current = s;
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: keep the in-memory session */
  }
  emit();
}

function emit() {
  for (const l of listeners) l();
}

const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
const toStored = (t: TokenPairLike): StoredSession => ({
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  accessExpiresAt: iso(t.accessExpiresAt),
  refreshExpiresAt: iso(t.refreshExpiresAt),
});
const refreshExpired = (s: StoredSession) => Date.parse(s.refreshExpiresAt) <= now();
const accessFresh = (s: StoredSession) => Date.parse(s.accessExpiresAt) - REFRESH_SKEW_MS > now();

/** Another tab signed in, refreshed or signed out: take its copy. */
function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== KEY) return;
  const next = parse(e.newValue);
  if (!next) generation += 1;
  current = next;
  emit();
}
if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

export function getSession(): StoredSession | null {
  return read();
}

/** Bearer token as stored; `null` when signed out or the refresh window has passed. */
export function getAccessToken(): string | null {
  const s = read();
  if (!s) return null;
  if (refreshExpired(s)) return null;
  return s.accessToken;
}

/** The token for the next request: renews first when it is about to run out (never throws). */
export async function getFreshAccessToken(): Promise<string | null> {
  const s = read();
  if (!s || refreshExpired(s)) return null;
  if (accessFresh(s)) return s.accessToken;
  await refreshSession();
  return getAccessToken();
}

export function setRefresher(fn: Refresher | null) {
  refresher = fn;
}

export function setSession(tokens: TokenPairLike) {
  generation += 1;
  inflight = null;
  write(toStored(tokens));
}

export function clearSession() {
  generation += 1;
  inflight = null;
  write(null);
}

/** True when the server refused the token (401), not when the network failed. */
export function isAuthError(err: unknown): boolean {
  const data = (err as { data?: { httpStatus?: number } } | null)?.data;
  return data?.httpStatus === 401;
}

type LockRunner = <T>(fn: () => Promise<T>) => Promise<T>;

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return fn();
  return locks.request(LOCK, () => fn()) as Promise<T>;
}
let runLocked: LockRunner = withRefreshLock;

/**
 * Single-flight refresh. Resolves true when a fresh pair is stored (by this tab or another);
 * false when there is no session or refresher, the network failed (session kept), or the server
 * refused the token (signed out).
 */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  const start = read();
  if (!start || !refresher) return Promise.resolve(false);
  if (refreshExpired(start)) {
    clearSession();
    return Promise.resolve(false);
  }
  const gen = generation;
  const run = refresher;
  const flight: Promise<boolean> = runLocked(async () => {
    // Inside the lock: another tab may have rotated the pair while we waited.
    const latest = readStorage() ?? read();
    if (gen !== generation || !latest) return false;
    if (latest.refreshToken !== start.refreshToken) {
      current = latest;
      emit();
      return !refreshExpired(latest);
    }
    try {
      const tokens = await run(latest.refreshToken);
      if (gen !== generation) return false;
      write(toStored(tokens));
      return true;
    } catch (err) {
      if (gen !== generation) return false;
      if (isAuthError(err)) clearSession();
      return false;
    }
  }).finally(() => {
    if (inflight === flight) inflight = null;
  });
  inflight = flight;
  return flight;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** `true` when a session is stored. Server render always reports signed out. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getAccessToken() !== null,
    () => false,
  );
}

/** Test seam: a fixed clock, a fake lock, and a clean module state. */
export const __test = {
  reset(opts: { now?: () => number; lock?: LockRunner } = {}) {
    current = undefined;
    refresher = null;
    inflight = null;
    generation = 0;
    now = opts.now ?? (() => Date.now());
    runLocked = opts.lock ?? withRefreshLock;
    listeners.clear();
  },
  onStorage,
};
