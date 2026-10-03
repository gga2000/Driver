'use client';

import { useSyncExternalStore } from 'react';

/**
 * Console session: the token pair from identity.verifyOtp, kept in memory and mirrored to
 * localStorage so a reload stays signed in. Storage access is wrapped — private windows and
 * blocked storage just mean "signed out after reload".
 *
 * M2 trade-off: the refresh token sits in localStorage. Move to an httpOnly cookie when the
 * console gets its own BFF.
 */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

const KEY = 'driver.console.session';
let current: StoredSession | null | undefined; // undefined = not yet read from storage
const listeners = new Set<() => void>();

function read(): StoredSession | null {
  if (current !== undefined) return current;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
    current = raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    current = null;
  }
  return current;
}

function emit() {
  for (const l of listeners) l();
}

export function getSession(): StoredSession | null {
  return read();
}

/** Bearer token for the tRPC link; `null` when signed out or the refresh window has passed. */
export function getAccessToken(): string | null {
  const s = read();
  if (!s) return null;
  if (Date.parse(s.refreshExpiresAt) < Date.now()) return null;
  return s.accessToken;
}

export function setSession(tokens: { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date }) {
  current = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
    refreshExpiresAt: tokens.refreshExpiresAt.toISOString(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage blocked: keep the in-memory session */
  }
  emit();
}

export function clearSession() {
  current = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
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
