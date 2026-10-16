import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRouter } from '@driver/contracts';
import {
  appBuildHeaders,
  isUpdateRequired,
  markUpdateRequired,
  resetUpdateRequiredForTests,
  resolveBuild,
  shouldRetryQuery,
  stopLiveOnUpdateRequired,
  subscribeUpdateRequired,
  updateRequiredLink,
} from './app-version';

const apiError = (code: string, httpStatus: number) =>
  new TRPCClientError(code, { result: { error: { message: code, code: -32000, data: { httpStatus, code } } } as never });
const tooOld = () => apiError('update_required', 412);

afterEach(() => resetUpdateRequiredForTests());

describe('the build header (CORE-05)', () => {
  it('native sends merchant/<store version>; web sends nothing', () => {
    expect(appBuildHeaders(resolveBuild({ os: 'android', nativeVersion: '1.0.3', devTools: false, search: '' }))).toEqual({ 'x-driver-app': 'merchant/1.0.3' });
    expect(appBuildHeaders(resolveBuild({ os: 'ios', nativeVersion: null, devTools: false, search: '' }))).toEqual({});
    expect(appBuildHeaders(resolveBuild({ os: 'web', nativeVersion: null, devTools: false, search: '?demoBuild=0.0.1' }))).toEqual({});
  });

  it('only a dev-tools web export takes ?demoBuild, and only a plain dotted version', () => {
    expect(resolveBuild({ os: 'web', nativeVersion: null, devTools: true, search: '?demoBuild=0.0.1' })).toBe('0.0.1');
    expect(resolveBuild({ os: 'web', nativeVersion: null, devTools: true, search: '?demoBuild=1.0;x' })).toBeNull();
    expect(resolveBuild({ os: 'web', nativeVersion: null, devTools: true, search: '' })).toBeNull();
    // A native build ignores the query string.
    expect(resolveBuild({ os: 'android', nativeVersion: '1.2.0', devTools: true, search: '?demoBuild=0.0.1' })).toBe('1.2.0');
  });
});

describe('query retries', () => {
  it('retries a failure twice, never a 401 or an old build', () => {
    expect(shouldRetryQuery(0, new Error('network'))).toBe(true);
    expect(shouldRetryQuery(2, new Error('network'))).toBe(false);
    expect(shouldRetryQuery(0, apiError('session_expired', 401))).toBe(false);
    expect(shouldRetryQuery(0, tooOld())).toBe(false);
  });

  it('once the app is marked, nothing retries any more', () => {
    markUpdateRequired();
    expect(shouldRetryQuery(0, new Error('network'))).toBe(false);
  });
});

describe('the app-wide switch', () => {
  it('flips once, tells listeners once, and stays', () => {
    const seen = vi.fn();
    const off = subscribeUpdateRequired(seen);
    expect(isUpdateRequired()).toBe(false);
    markUpdateRequired();
    markUpdateRequired();
    expect(isUpdateRequired()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('the link marks the app on update_required and passes every error on', async () => {
    let answer: Error = apiError('rate_limited', 429);
    const server: TRPCLink<AppRouter> = () => () => observable((o) => o.error(answer as TRPCClientError<AppRouter>));
    const client = createTRPCClient<AppRouter>({ links: [updateRequiredLink(), server] });
    await expect(client.identity.me.query()).rejects.toThrow('rate_limited');
    expect(isUpdateRequired()).toBe(false);
    answer = tooOld();
    await expect(client.identity.me.query()).rejects.toThrow('update_required');
    expect(isUpdateRequired()).toBe(true);
  });
});

describe('the live stream', () => {
  const handlers = () => ({ onData: vi.fn(), onError: vi.fn(), onComplete: vi.fn() });

  it('update_required stops the connection instead of reaching its reconnect backoff', () => {
    const h = handlers();
    const stop = vi.fn();
    stopLiveOnUpdateRequired(h, stop).onError(tooOld());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
    expect(isUpdateRequired()).toBe(true);
  });

  it('any other error goes to the connection as before (it reconnects)', () => {
    const h = handlers();
    const stop = vi.fn();
    const err = apiError('session_expired', 401);
    stopLiveOnUpdateRequired(h, stop).onError(err);
    expect(stop).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith(err);
    expect(isUpdateRequired()).toBe(false);
  });
});
