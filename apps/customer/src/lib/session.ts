import { useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from './storage';

/**
 * Customer session: the token pair from `identity.verifyOtp`, persisted in secure storage
 * (expo-secure-store on native, localStorage on web) and refreshed through `identity.refresh`.
 *
 * - `getAccessToken()` refreshes proactively when the access token is about to expire.
 * - The API link calls `refresh()` once more on a 401 and retries the request (see api.ts).
 * - Refreshes are single-flight: the API rotates refresh tokens and treats a reused one as theft
 *   (`refresh_reused` revokes the session), so two parallel refreshes would sign the person out.
 * - A refresh refused by the server (401) signs out; a network failure or a timeout keeps the session.
 */

export interface TokenPairLike {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date | string;
  refreshExpiresAt: Date | string;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  personId: string | null;
}

export type SessionStatus = 'loading' | 'signedIn' | 'signedOut';

export interface SessionSnapshot {
  status: SessionStatus;
  session: StoredSession | null;
}

export type Refresher = (refreshToken: string) => Promise<TokenPairLike>;

export interface SessionStoreOptions {
  storage: KeyValueStorage;
  key?: string;
  now?: () => number;
  /** Refresh this long before the access token expires. */
  refreshSkewMs?: number;
  /** True when a refresh failure means the server refused the token (sign out), not a network blip. */
  isAuthError?: (err: unknown) => boolean;
  /**
   * A refresh that hasn't settled after this long counts as a network failure (session kept), so the
   * single-flight promise every request waits on always settles (audit CORE-01). Just over the refresh
   * request's own deadline, as a backstop for a refresher that never answers.
   */
  refreshTimeoutMs?: number;
}

export const REFRESH_TIMEOUT_MS = 12_000;

export const SESSION_KEY = 'driver.customer.session';

/** tRPC puts the HTTP status on `error.data.httpStatus`; our envelope adds `code`. */
export function isAuthError(err: unknown): boolean {
  const data = (err as { data?: { httpStatus?: number } } | null)?.data;
  return data?.httpStatus === 401;
}

function toStored(tokens: TokenPairLike, personId: string | null): StoredSession {
  const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: iso(tokens.accessExpiresAt),
    refreshExpiresAt: iso(tokens.refreshExpiresAt),
    personId,
  };
}

function parseStored(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.accessToken !== 'string' || typeof v.refreshToken !== 'string') return null;
    if (typeof v.accessExpiresAt !== 'string' || typeof v.refreshExpiresAt !== 'string') return null;
    return {
      accessToken: v.accessToken,
      refreshToken: v.refreshToken,
      accessExpiresAt: v.accessExpiresAt,
      refreshExpiresAt: v.refreshExpiresAt,
      personId: typeof v.personId === 'string' ? v.personId : null,
    };
  } catch {
    return null;
  }
}

/** `work`, or a rejection that is not an auth error once `ms` have passed. */
function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('refresh_timeout')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export function createSessionStore(opts: SessionStoreOptions) {
  const key = opts.key ?? SESSION_KEY;
  const now = opts.now ?? Date.now;
  const skew = opts.refreshSkewMs ?? 30_000;
  const authError = opts.isAuthError ?? isAuthError;
  const refreshTimeoutMs = opts.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS;

  let snapshot: SessionSnapshot = { status: 'loading', session: null };
  let refresher: Refresher | null = null;
  let inflight: Promise<boolean> | null = null;
  let hydrating: Promise<void> | null = null;
  /** Bumped on every sign-in/out so a refresh that started before can't resurrect a session. */
  let generation = 0;
  const listeners = new Set<() => void>();
  const signOutListeners = new Set<() => void>();

  function set(next: SessionSnapshot) {
    snapshot = next;
    for (const l of listeners) l();
  }

  const refreshExpired = (s: StoredSession) => Date.parse(s.refreshExpiresAt) <= now();
  const accessFresh = (s: StoredSession) => Date.parse(s.accessExpiresAt) - skew > now();

  async function persist(s: StoredSession | null) {
    if (s) await opts.storage.setItem(key, JSON.stringify(s));
    else await opts.storage.removeItem(key);
  }

  const store = {
    getSnapshot: (): SessionSnapshot => snapshot,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    /** Called on every sign-out (explicit or forced) — the API layer clears cached queries here. */
    onSignOut(cb: () => void) {
      signOutListeners.add(cb);
      return () => {
        signOutListeners.delete(cb);
      };
    },
    setRefresher(fn: Refresher | null) {
      refresher = fn;
    },

    /** Reads the stored session once at start-up. Safe to call repeatedly. */
    hydrate(): Promise<void> {
      if (snapshot.status !== 'loading') return Promise.resolve();
      hydrating ??= (async () => {
        let stored: StoredSession | null = null;
        try {
          stored = parseStored(await opts.storage.getItem(key));
        } catch {
          stored = null;
        }
        if (snapshot.status !== 'loading') return; // signIn raced ahead of hydration
        if (stored && refreshExpired(stored)) {
          await persist(null).catch(() => {});
          stored = null;
        }
        set(stored ? { status: 'signedIn', session: stored } : { status: 'signedOut', session: null });
      })();
      return hydrating;
    },

    async signIn(tokens: TokenPairLike, personId: string | null = null) {
      generation += 1;
      const s = toStored(tokens, personId);
      set({ status: 'signedIn', session: s });
      await persist(s).catch(() => {});
    },

    async signOut() {
      const wasSignedIn = snapshot.status === 'signedIn';
      generation += 1;
      inflight = null;
      set({ status: 'signedOut', session: null });
      await persist(null).catch(() => {});
      if (wasSignedIn) for (const l of signOutListeners) l();
    },

    /**
     * Single-flight refresh. Resolves true when a fresh pair is stored; false when there is no
     * session, no refresher, the network failed (session kept) or the server refused (signed out).
     */
    refresh(): Promise<boolean> {
      if (inflight) return inflight;
      const s = snapshot.session;
      if (!s || !refresher) return Promise.resolve(false);
      if (refreshExpired(s)) {
        return store.signOut().then(() => false);
      }
      const gen = generation;
      const run = refresher;
      inflight = (async () => {
        try {
          const tokens = await deadline(run(s.refreshToken), refreshTimeoutMs);
          if (gen !== generation) return false;
          const next = toStored(tokens, s.personId);
          set({ status: 'signedIn', session: next });
          await persist(next).catch(() => {});
          return true;
        } catch (err) {
          if (gen !== generation) return false;
          if (authError(err)) await store.signOut();
          return false;
        } finally {
          if (gen === generation) inflight = null;
        }
      })();
      return inflight;
    },

    /** Bearer token for the next request; refreshes first when it is about to expire. */
    async getAccessToken(): Promise<string | null> {
      if (snapshot.status === 'loading') await store.hydrate();
      const s = snapshot.session;
      if (!s) return null;
      if (accessFresh(s)) return s.accessToken;
      const ok = await store.refresh();
      if (ok) return snapshot.session?.accessToken ?? null;
      // Network failure: send the old token and let the server answer (the 401 path retries once).
      return snapshot.session?.accessToken ?? null;
    },
  };
  return store;
}

export type SessionStore = ReturnType<typeof createSessionStore>;

/** The app's session (secure storage on native, localStorage on web). */
export const session = createSessionStore({ storage: platformStorage });

export function useSession(store: SessionStore = session): SessionSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** True once a session is loaded and present. Protected queries pass `enabled: useSignedIn()`. */
export function useSignedIn(store: SessionStore = session): boolean {
  return useSession(store).status === 'signedIn';
}
