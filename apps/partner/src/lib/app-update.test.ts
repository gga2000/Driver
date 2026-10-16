import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { afterEach, describe, expect, it } from 'vitest';
import { isUpdateRequiredError, type AppRouter } from '@driver/contracts';
import { appBuildHeaders, isUpdateRequired, resetUpdateRequiredForTests, updateGateLink } from './app-update';

afterEach(() => resetUpdateRequiredForTests());

function refusedError() {
  return new TRPCClientError('update', { result: { error: { message: 'update', code: -32001, data: { httpStatus: 412, code: 'update_required', message_ar: 'أكو نسخة جديدة' } } } as never });
}

/** Stands in for httpBatchLink: answers each call from `respond`, counting what reached it. */
function fakeServer(respond: (path: string) => unknown) {
  const calls: string[] = [];
  const link: TRPCLink<AppRouter> = () => ({ op }) =>
    observable((o) => {
      calls.push(op.path);
      const res = respond(op.path);
      if (res instanceof Error) o.error(res as TRPCClientError<AppRouter>);
      else {
        o.next({ result: { type: 'data', data: res } } as never);
        o.complete();
      }
    });
  return { link, calls };
}

describe('the build header', () => {
  it('says partner/<store version>, and nothing without one', () => {
    expect(appBuildHeaders('1.0.3')).toEqual({ 'x-driver-app': 'partner/1.0.3' });
    expect(appBuildHeaders(null)).toEqual({});
  });
});

describe('updateGateLink', () => {
  it('lets calls through until the server refuses the build', async () => {
    const server = fakeServer(() => ({ ok: true }));
    const client = createTRPCClient<AppRouter>({ links: [updateGateLink(), server.link] });
    await expect(client.identity.me.query()).resolves.toEqual({ ok: true });
    await expect(client.identity.me.query()).resolves.toEqual({ ok: true });
    expect(server.calls).toHaveLength(2);
    expect(isUpdateRequired()).toBe(false);
  });

  it('after update_required, answers every call itself and never reaches the server again', async () => {
    let refuse = true;
    const server = fakeServer(() => (refuse ? refusedError() : { ok: true }));
    const client = createTRPCClient<AppRouter>({ links: [updateGateLink(), server.link] });
    const first = await client.partner.status.query().catch((e: unknown) => e);
    expect(isUpdateRequiredError(first)).toBe(true);
    expect(isUpdateRequired()).toBe(true);
    refuse = false;
    const again = await client.identity.me.query().catch((e: unknown) => e);
    expect(isUpdateRequiredError(again)).toBe(true);
    expect(server.calls).toEqual(['partner.status']);
  });

  it('other errors change nothing', async () => {
    const server = fakeServer(() => new TRPCClientError('nope', { result: { error: { message: 'nope', code: -32001, data: { httpStatus: 500, code: 'internal' } } } as never }));
    const client = createTRPCClient<AppRouter>({ links: [updateGateLink(), server.link] });
    await expect(client.identity.me.query()).rejects.toThrow();
    expect(isUpdateRequired()).toBe(false);
  });
});
