import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The session module mirrors to localStorage and listens for other tabs; give it a small window.
const store = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener: () => {},
};
vi.stubGlobal('window', fakeWindow);

type Session = typeof import('./session');
let s: Session;
beforeAll(async () => {
  s = await import('./session');
});

const KEY = 'driver.console.session';
const MIN = 60_000;
const T0 = Date.parse('2026-11-16T15:00:00Z');
let clock = T0;
const pair = (n: number, at = clock) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}-xxxxxxxxxxxxxxxx`,
  accessExpiresAt: new Date(at + 15 * MIN),
  refreshExpiresAt: new Date(at + 30 * 24 * 60 * MIN),
});
const err401 = () => Object.assign(new Error('expired'), { data: { httpStatus: 401, code: 'session_expired' } });

/** A lock that serialises like navigator.locks does across tabs. */
function fifoLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

beforeEach(() => {
  store.clear();
  clock = T0;
  s.__test.reset({ now: () => clock, lock: fifoLock() });
});

describe('console session refresh (CON-01)', () => {
  it('uses the stored token while it is fresh, and renews it a minute before it runs out', async () => {
    s.setSession(pair(1));
    const refresher = vi.fn(async () => pair(2));
    s.setRefresher(refresher);

    expect(await s.getFreshAccessToken()).toBe('access-1');
    expect(refresher).not.toHaveBeenCalled();

    clock = T0 + 14 * MIN + 30_000;
    expect(await s.getFreshAccessToken()).toBe('access-2');
    expect(refresher).toHaveBeenCalledWith('refresh-1-xxxxxxxxxxxxxxxx');
    expect(JSON.parse(store.get(KEY)!).refreshToken).toBe('refresh-2-xxxxxxxxxxxxxxxx');
  });

  it('spends a refresh token once, however many requests ask at the same time', async () => {
    s.setSession(pair(1));
    const refresher = vi.fn(async () => pair(2));
    s.setRefresher(refresher);
    clock = T0 + 15 * MIN;

    const tokens = await Promise.all([s.getFreshAccessToken(), s.getFreshAccessToken(), s.refreshSession()]);
    expect(tokens).toEqual(['access-2', 'access-2', true]);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('adopts the pair another tab already rotated instead of reusing the old refresh token', async () => {
    s.setSession(pair(1));
    const refresher = vi.fn(async () => pair(9));
    s.setRefresher(refresher);
    // The other tab refreshed while this one waited for the lock.
    store.set(KEY, JSON.stringify({ ...pair(2), accessExpiresAt: pair(2).accessExpiresAt.toISOString(), refreshExpiresAt: pair(2).refreshExpiresAt.toISOString() }));
    clock = T0 + 15 * MIN;

    expect(await s.refreshSession()).toBe(true);
    expect(refresher).not.toHaveBeenCalled();
    expect(s.getAccessToken()).toBe('access-2');
  });

  it('signs out when the server refuses the refresh token, keeps the session on a network failure', async () => {
    s.setSession(pair(1));
    s.setRefresher(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await s.refreshSession()).toBe(false);
    expect(s.getSession()).not.toBeNull();

    s.setRefresher(async () => {
      throw err401();
    });
    expect(await s.refreshSession()).toBe(false);
    expect(s.getSession()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('a sign-out during a refresh is not undone when the refresh answers', async () => {
    s.setSession(pair(1));
    let answer!: (p: ReturnType<typeof pair>) => void;
    s.setRefresher(() => new Promise((r) => (answer = r)));
    const flight = s.refreshSession();
    await Promise.resolve();
    s.clearSession();
    answer(pair(2));
    expect(await flight).toBe(false);
    expect(s.getSession()).toBeNull();
  });

  it('another tab signing out signs this tab out too', () => {
    s.setSession(pair(1));
    s.__test.onStorage({ key: KEY, newValue: null } as StorageEvent);
    expect(s.getAccessToken()).toBeNull();
  });

  it('gate C1: an 8-hour shift with a call every 5 minutes never signs out', async () => {
    let n = 1;
    s.setSession(pair(n));
    s.setRefresher(async (rt) => {
      expect(rt).toBe(`refresh-${n}-xxxxxxxxxxxxxxxx`); // never a reused token
      n += 1;
      return pair(n);
    });
    for (let minute = 0; minute <= 8 * 60; minute += 5) {
      clock = T0 + minute * MIN;
      const token = await s.getFreshAccessToken();
      expect(token).not.toBeNull();
      const stored = s.getSession()!;
      expect(Date.parse(stored.accessExpiresAt)).toBeGreaterThan(clock);
    }
    expect(n).toBeGreaterThanOrEqual(32);
  });
});
