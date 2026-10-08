import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { describe, expect, it, vi } from 'vitest';
import type { AppRouter } from '@driver/contracts';
import { authRetryLink } from './auth-link';

const isAuthError = (err: unknown) => (err as { data?: { httpStatus?: number } }).data?.httpStatus === 401;
const err401 = () =>
  new TRPCClientError('expired', { result: { error: { message: 'expired', code: -32001, data: { httpStatus: 401, code: 'session_expired' } } } as never });

/** Stands in for httpBatchLink: answers each call from `respond(path, token)`. */
function server(token: () => string, respond: (path: string, token: string) => unknown) {
  const calls: { path: string; token: string }[] = [];
  const link: TRPCLink<AppRouter> = () => ({ op }) =>
    observable((o) => {
      const t = token();
      calls.push({ path: op.path, token: t });
      const res = respond(op.path, t);
      if (res instanceof Error) o.error(res as TRPCClientError<AppRouter>);
      else {
        o.next({ result: { type: 'data', data: res } } as never);
        o.complete();
      }
    });
  return { link, calls };
}

describe('auth retry link (CON-01)', () => {
  it('renews once on a 401 and replays the call with the new token', async () => {
    let token = 'old';
    const refresh = vi.fn(async () => {
      token = 'new';
      return true;
    });
    const s = server(() => token, (_p, t) => (t === 'old' ? err401() : { ok: true }));
    const client = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => true, refresh }), s.link] });

    await expect(client.console.rightNow.query({} as never)).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(s.calls.map((c) => c.token)).toEqual(['old', 'new']);
  });

  it('gives the 401 to the caller when the refresh fails or the replay is refused again', async () => {
    const failed = server(() => 'old', () => err401());
    const c1 = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => true, refresh: async () => false }), failed.link] });
    await expect(c1.console.rightNow.query({} as never)).rejects.toThrow('expired');
    expect(failed.calls).toHaveLength(1);

    const again = server(() => 'x', () => err401());
    const c2 = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => true, refresh: async () => true }), again.link] });
    await expect(c2.console.rightNow.query({} as never)).rejects.toThrow('expired');
    expect(again.calls).toHaveLength(2);
  });

  it('never retries identity.refresh itself, nor anything when signed out', async () => {
    const refresh = vi.fn(async () => true);
    const s = server(() => 'x', () => err401());
    const c = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => true, refresh }), s.link] });
    await expect(c.identity.refresh.mutate({ refreshToken: 'refresh-xxxxxxxxxxxxxxxx' })).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();

    const out = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => false, refresh }), s.link] });
    await expect(out.console.rightNow.query({} as never)).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes other errors straight through', async () => {
    const refresh = vi.fn(async () => true);
    const forbidden = new TRPCClientError('no', { result: { error: { message: 'no', code: -32003, data: { httpStatus: 403 } } } as never });
    const s = server(() => 'x', () => forbidden);
    const c = createTRPCClient<AppRouter>({ links: [authRetryLink({ isAuthError, hasSession: () => true, refresh }), s.link] });
    await expect(c.console.rightNow.query({} as never)).rejects.toThrow('no');
    expect(refresh).not.toHaveBeenCalled();
  });
});
