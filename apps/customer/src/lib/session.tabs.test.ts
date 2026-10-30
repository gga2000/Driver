import { describe, expect, it } from 'vitest';
import { createSessionStore, REFRESH_LOCK, type TokenPairLike } from './session';
import { storage as webStorage, type KeyValueStorage } from './storage';

const T0 = Date.parse('2026-10-03T12:00:00Z');
const authErr = () => Object.assign(new Error('refresh_reused'), { data: { httpStatus: 401, code: 'refresh_reused' } });

/**
 * One browser: tabs share one localStorage, one lock manager, and each tab hears the others' writes
 * (never its own) when `deliver()` runs, like the `storage` event.
 */
function browser() {
  const map = new Map<string, string>();
  const watchers: Array<{ tab: number; key: string; cb: (v: string | null) => void }> = [];
  const pending: Array<() => void> = [];
  let chain: Promise<unknown> = Promise.resolve();
  const locks: string[] = [];
  const tabStorage = (tab: number): KeyValueStorage => {
    const changed = (key: string, value: string | null) => {
      for (const w of watchers) if (w.tab !== tab && w.key === key) pending.push(() => w.cb(value));
    };
    return {
      getItem: async (k) => map.get(k) ?? null,
      setItem: async (k, v) => {
        map.set(k, v);
        changed(k, v);
      },
      removeItem: async (k) => {
        map.delete(k);
        changed(k, null);
      },
      lock: <T,>(name: string, fn: () => Promise<T>) => {
        locks.push(name);
        const run = chain.then(fn, fn);
        chain = run.catch(() => undefined);
        return run;
      },
      watch: (key, cb) => {
        const w = { tab, key, cb };
        watchers.push(w);
        return () => watchers.splice(watchers.indexOf(w), 1);
      },
    };
  };
  return { tabStorage, locks, deliver: () => pending.splice(0).forEach((f) => f()) };
}

/** The API's rotation: only the newest refresh token works; a retired one ends the session. */
function server() {
  let n = 1;
  let live = 'refresh-1';
  let calls = 0;
  const pair = (i: number): TokenPairLike => ({
    accessToken: `access-${i}`,
    refreshToken: `refresh-${i}`,
    accessExpiresAt: new Date(T0 + 15 * 60_000 + i),
    refreshExpiresAt: new Date(T0 + 30 * 86_400_000),
  });
  return {
    first: pair(1),
    get calls() {
      return calls;
    },
    refresher: async (token: string) => {
      calls += 1;
      await Promise.resolve();
      if (token !== live) {
        live = '';
        throw authErr();
      }
      n += 1;
      live = `refresh-${n}`;
      return pair(n);
    },
  };
}

async function twoTabs() {
  const b = browser();
  const api = server();
  const now = () => T0 + 20 * 60_000; // both tabs' access tokens are due
  const tabA = createSessionStore({ storage: b.tabStorage(1), now });
  const tabB = createSessionStore({ storage: b.tabStorage(2), now });
  await tabA.hydrate();
  await tabA.signIn(api.first, 'p_1');
  await tabB.hydrate();
  b.deliver();
  tabA.setRefresher(api.refresher);
  tabB.setRefresher(api.refresher);
  return { b, api, tabA, tabB };
}

describe('session store on the web: several tabs, one session', () => {
  it('a tab that refreshes after another takes the rotated pair instead of spending the retired token', async () => {
    const { api, tabA, tabB } = await twoTabs();
    expect(await tabA.refresh()).toBe(true);
    // Tab B never heard about it (its storage event is still on the way) and its token is due too.
    expect(await tabB.refresh()).toBe(true);
    expect(api.calls).toBe(1);
    expect(tabB.getSnapshot()).toMatchObject({ status: 'signedIn', session: { refreshToken: 'refresh-2', personId: 'p_1' } });
    // And tab A still works afterwards.
    expect(tabA.getSnapshot().session?.refreshToken).toBe('refresh-2');
  });

  it('two tabs refreshing at the same moment make one call to the server, under the shared lock', async () => {
    const { b, api, tabA, tabB } = await twoTabs();
    const [a, bOk] = await Promise.all([tabA.refresh(), tabB.refresh()]);
    expect([a, bOk]).toEqual([true, true]);
    expect(api.calls).toBe(1);
    expect(b.locks.every((l) => l === REFRESH_LOCK)).toBe(true);
    expect(tabA.getSnapshot().session?.refreshToken).toBe(tabB.getSnapshot().session?.refreshToken);
  });

  it('new tokens from another tab reach this one', async () => {
    const { b, tabA, tabB } = await twoTabs();
    await tabA.refresh();
    b.deliver();
    expect(tabB.getSnapshot().session?.accessToken).toBe('access-2');
  });

  it('signing out in one tab signs out every tab', async () => {
    const { b, tabA, tabB } = await twoTabs();
    let heard = 0;
    tabB.onSignOut(() => (heard += 1));
    await tabA.signOut();
    b.deliver();
    expect(tabB.getSnapshot()).toEqual({ status: 'signedOut', session: null });
    expect(heard).toBe(1);
  });

  it('a tab whose refresh waited while another signed out does not bring the session back', async () => {
    const { api, tabA, tabB } = await twoTabs();
    await tabA.signOut();
    expect(await tabB.refresh()).toBe(false);
    expect(api.calls).toBe(0);
    expect(tabB.getSnapshot().status).toBe('signedOut');
  });
});

describe('web storage', () => {
  it('runs the work directly where the browser has no Web Locks', async () => {
    const nav = (globalThis as { navigator?: { locks?: unknown } }).navigator;
    const saved = nav?.locks;
    if (nav) Object.defineProperty(nav, 'locks', { value: undefined, configurable: true });
    try {
      expect(await webStorage.lock!('driver-refresh', async () => 7)).toBe(7);
    } finally {
      if (nav) Object.defineProperty(nav, 'locks', { value: saved, configurable: true });
    }
  });
});
