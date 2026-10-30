import { describe, expect, it } from 'vitest';
import { isProviderError, send, timedFetch } from './http.js';

/** A gateway that never answers (or stalls mid-body) must fail fast as a retryable network error. */
describe('provider calls have a deadline', () => {
  const hangs = (init: RequestInit) =>
    new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error)));

  it('a gateway that never answers becomes a transient network error', async () => {
    const fetchImpl = timedFetch(20, (_url, init) => hangs(init));
    const err = await send('sms', fetchImpl, 'https://sms.example.iq/send', { method: 'POST', headers: {} }).catch((e: unknown) => e);
    expect(isProviderError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'network', permanent: false });
  });

  it('a body that stalls after the headers is covered too', async () => {
    const fetchImpl = timedFetch(20, async (_url, init) => ({ status: 200, text: () => hangs(init) }));
    await expect(send('sms', fetchImpl, 'https://sms.example.iq/send', { method: 'POST', headers: {} })).rejects.toMatchObject({ code: 'network' });
  });

  it('a quick answer passes through untouched', async () => {
    const fetchImpl = timedFetch(1000, async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return { status: 202, text: async () => '{"id":"m1"}' };
    });
    await expect(send('sms', fetchImpl, 'https://sms.example.iq/send', { method: 'POST', headers: {}, body: '{}' })).resolves.toEqual({ status: 202, body: '{"id":"m1"}' });
  });
});
