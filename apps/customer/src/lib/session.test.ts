import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, SESSION_KEY, type TokenPairLike } from './session';
import { createMemoryStorage } from './storage';

const T0 = Date.parse('2026-10-03T12:00:00Z');

function pair(n: number, now = T0, accessMs = 15 * 60_000): TokenPairLike {
  return {
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}-xxxxxxxxxxxxxxxx`,
    accessExpiresAt: new Date(now + accessMs),
    refreshExpiresAt: new Date(now + 30 * 86_400_000),
  };
}

const authErr = () => Object.assign(new Error('refresh_reused'), { data: { httpStatus: 401, code: 'refresh_reused' } });

function setup(seed?: Record<string, string>) {
  let now = T0;
  const storage = createMemoryStorage(seed);
  const store = createSessionStore({ storage, now: () => now });
  return { store, storage, advance: (ms: number) => (now += ms) };
}

describe('session store', () => {
  it('hydrates signed out when nothing is stored', async () => {
    const { store } = setup();
    expect(store.getSnapshot().status).toBe('loading');
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ status: 'signedOut', session: null });
  });

  it('persists on sign-in and restores on the next launch', async () => {
    const a = setup();
    await a.store.hydrate();
    await a.store.signIn(pair(1), 'p_1');
    const raw = a.storage.dump()[SESSION_KEY]!;
    expect(JSON.parse(raw)).toMatchObject({ accessToken: 'access-1', personId: 'p_1' });

    const b = setup({ [SESSION_KEY]: raw });
    await b.store.hydrate();
    expect(b.store.getSnapshot().status).toBe('signedIn');
    expect(await b.store.getAccessToken()).toBe('access-1');
  });

  it('drops a stored session whose refresh window has passed', async () => {
    const stale = { ...pair(1), refreshExpiresAt: new Date(T0 - 1000), accessExpiresAt: new Date(T0 - 2000) };
    const raw = JSON.stringify({ ...stale, accessExpiresAt: stale.accessExpiresAt.toISOString(), refreshExpiresAt: stale.refreshExpiresAt.toISOString() });
    const { store, storage } = setup({ [SESSION_KEY]: raw });
    await store.hydrate();
    expect(store.getSnapshot().status).toBe('signedOut');
    expect(storage.dump()[SESSION_KEY]).toBeUndefined();
  });

  it('ignores corrupt storage', async () => {
    const { store } = setup({ [SESSION_KEY]: '{not json' });
    await store.hydrate();
    expect(store.getSnapshot().status).toBe('signedOut');
  });

  it('refreshes proactively when the access token is about to expire', async () => {
    const { store, advance } = setup();
    await store.signIn(pair(1), 'p_1');
    const refresher = vi.fn(async () => pair(2, T0 + 15 * 60_000));
    store.setRefresher(refresher);
    expect(await store.getAccessToken()).toBe('access-1');
    expect(refresher).not.toHaveBeenCalled();
    advance(15 * 60_000 - 10_000); // 10 s left, inside the 30 s skew
    expect(await store.getAccessToken()).toBe('access-2');
    expect(refresher).toHaveBeenCalledWith('refresh-1-xxxxxxxxxxxxxxxx');
    expect(store.getSnapshot().session?.personId).toBe('p_1');
  });

  it('is single-flight: parallel refreshes share one call (refresh tokens rotate)', async () => {
    const { store } = setup();
    await store.signIn(pair(1));
    let resolve!: (p: TokenPairLike) => void;
    const refresher = vi.fn(() => new Promise<TokenPairLike>((r) => (resolve = r)));
    store.setRefresher(refresher);
    const a = store.refresh();
    const b = store.refresh();
    resolve(pair(2));
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().session?.accessToken).toBe('access-2');
  });

  it('signs out when the server refuses the refresh (401)', async () => {
    const { store, storage } = setup();
    await store.signIn(pair(1));
    const onSignOut = vi.fn();
    store.onSignOut(onSignOut);
    store.setRefresher(async () => {
      throw authErr();
    });
    expect(await store.refresh()).toBe(false);
    expect(store.getSnapshot().status).toBe('signedOut');
    expect(storage.dump()[SESSION_KEY]).toBeUndefined();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the session on a network failure', async () => {
    const { store } = setup();
    await store.signIn(pair(1));
    store.setRefresher(async () => {
      throw new TypeError('Network request failed');
    });
    expect(await store.refresh()).toBe(false);
    expect(store.getSnapshot().status).toBe('signedIn');
    expect(store.getSnapshot().session?.accessToken).toBe('access-1');
  });

  it('a refresh that finishes after sign-out does not resurrect the session', async () => {
    const { store } = setup();
    await store.signIn(pair(1));
    let resolve!: (p: TokenPairLike) => void;
    store.setRefresher(() => new Promise<TokenPairLike>((r) => (resolve = r)));
    const pending = store.refresh();
    await store.signOut();
    resolve(pair(2));
    expect(await pending).toBe(false);
    expect(store.getSnapshot()).toEqual({ status: 'signedOut', session: null });
  });

  it('returns no token when signed out', async () => {
    const { store } = setup();
    await store.hydrate();
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.refresh()).toBe(false);
  });

  it('a refresh that never answers gives up, keeps the session and frees every waiting request (CORE-01)', async () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const store = createSessionStore({ storage: createMemoryStorage(), now: () => now, refreshTimeoutMs: 10_000 });
      await store.hydrate();
      await store.signIn(pair(1));
      const refresher = vi.fn(() => new Promise<TokenPairLike>(() => {}));
      store.setRefresher(refresher);
      now += 15 * 60_000; // the access token is now about to expire
      const a = store.getAccessToken();
      const b = store.getAccessToken();
      await vi.advanceTimersByTimeAsync(10_000);
      // Both callers go on with the old token (the server's 401 path decides), the session stays.
      expect(await a).toBe('access-1');
      expect(await b).toBe('access-1');
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().status).toBe('signedIn');
      // The single-flight slot is free again: the next request tries a fresh refresh.
      refresher.mockResolvedValueOnce(pair(2, now));
      expect(await store.getAccessToken()).toBe('access-2');
    } finally {
      vi.useRealTimers();
    }
  });
});
