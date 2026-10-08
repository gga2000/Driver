import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { describe, expect, it, vi } from 'vitest';
import type { AppRouter } from '@driver/contracts';
import { apiErrorCode, apiErrorMessage, authRetryLink, inputTooLongForUrl } from './api-links';
import { createSessionStore, type TokenPairLike } from './session';
import { createMemoryStorage } from './storage';

const T0 = Date.parse('2026-10-03T12:00:00Z');
const pair = (n: number): TokenPairLike => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}-xxxxxxxxxxxxxxxx`,
  accessExpiresAt: new Date(T0 + 15 * 60_000),
  refreshExpiresAt: new Date(T0 + 30 * 86_400_000),
});

function err401(code = 'session_expired') {
  return new TRPCClientError('expired', { result: { error: { message: 'expired', code: -32001, data: { httpStatus: 401, code, message_ar: 'انتهت جلستك' } } } as never });
}

/** Terminating link standing in for httpBatchLink: answers from `respond(token, path)`. */
function fakeServer(store: ReturnType<typeof createSessionStore>, respond: (token: string | null, path: string) => unknown) {
  const calls: { path: string; token: string | null }[] = [];
  const link: TRPCLink<AppRouter> = () => ({ op }) =>
    observable((o) => {
      void store.getAccessToken().then((token) => {
        calls.push({ path: op.path, token });
        const res = respond(token, op.path);
        if (res instanceof Error) o.error(res as TRPCClientError<AppRouter>);
        else {
          o.next({ result: { type: 'data', data: res } } as never);
          o.complete();
        }
      });
    });
  return { link, calls };
}

async function signedInStore() {
  const store = createSessionStore({ storage: createMemoryStorage(), now: () => T0 });
  await store.signIn(pair(1), 'p_1');
  return store;
}

describe('authRetryLink', () => {
  it('refreshes once on a 401 and replays the call with the new token', async () => {
    const store = await signedInStore();
    const refresher = vi.fn(async () => pair(2));
    store.setRefresher(refresher);
    const server = fakeServer(store, (token) => (token === 'access-2' ? { ok: true } : err401()));
    const client = createTRPCClient<AppRouter>({ links: [authRetryLink(store), server.link] });

    await expect(client.identity.me.query()).resolves.toEqual({ ok: true });
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(server.calls.map((c) => c.token)).toEqual(['access-1', 'access-2']);
  });

  it('gives up after one retry and surfaces the 401', async () => {
    const store = await signedInStore();
    store.setRefresher(async () => pair(2));
    const server = fakeServer(store, () => err401());
    const client = createTRPCClient<AppRouter>({ links: [authRetryLink(store), server.link] });
    await expect(client.identity.me.query()).rejects.toBeInstanceOf(TRPCClientError);
    expect(server.calls).toHaveLength(2);
  });

  it('signs out when the refresh itself is refused', async () => {
    const store = await signedInStore();
    store.setRefresher(async () => {
      throw err401('refresh_reused');
    });
    const server = fakeServer(store, () => err401());
    const client = createTRPCClient<AppRouter>({ links: [authRetryLink(store), server.link] });
    await expect(client.orders.mine.query()).rejects.toBeInstanceOf(TRPCClientError);
    expect(store.getSnapshot().status).toBe('signedOut');
    expect(server.calls).toHaveLength(1);
  });

  it('does not retry when signed out or for non-auth errors', async () => {
    const store = createSessionStore({ storage: createMemoryStorage(), now: () => T0 });
    await store.hydrate();
    const refresher = vi.fn(async () => pair(2));
    store.setRefresher(refresher);
    const server = fakeServer(store, () => err401());
    const client = createTRPCClient<AppRouter>({ links: [authRetryLink(store), server.link] });
    await expect(client.identity.me.query()).rejects.toBeInstanceOf(TRPCClientError);
    expect(refresher).not.toHaveBeenCalled();
  });
});

describe('error helpers', () => {
  it('reads the Iraqi-Arabic envelope message and code', () => {
    const e = err401('otp_invalid');
    expect(apiErrorMessage(e, 'fallback')).toBe('انتهت جلستك');
    expect(apiErrorCode(e)).toBe('otp_invalid');
    expect(apiErrorMessage(new TypeError('offline'), 'ماكو نت')).toBe('ماكو نت');
    expect(apiErrorCode(new TypeError('offline'))).toBeNull();
  });
});

describe('queries too long for a URL (FOOD-18)', () => {
  const note = 'بدون بصل وزيادة طماطة رجاءً، والخبز حار إذا ممكن '.repeat(6);
  const basket = (lines: number) => ({ lines: Array.from({ length: lines }, (_, i) => ({ itemId: `item_${i}`, qty: 1, note })) });

  it('a small query stays a GET; a big basket with Arabic notes goes as POST', () => {
    expect(inputTooLongForUrl({ type: 'query', input: { cityId: 'aziziyah', query: 'كباب' } })).toBe(false);
    expect(inputTooLongForUrl({ type: 'query', input: basket(3) })).toBe(true);
    expect(inputTooLongForUrl({ type: 'query', input: undefined })).toBe(false);
  });

  it('mutations already go as POST', () => {
    expect(inputTooLongForUrl({ type: 'mutation', input: basket(25) })).toBe(false);
  });
});
