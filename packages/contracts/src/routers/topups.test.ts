import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind } from '../auth.js';
import { DriverError } from '../errors.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

/** `ctx.topups` that records which method and channel a procedure reached, then answers "not found". */
function caller(roles: readonly RoleKind[] | null) {
  const calls: string[] = [];
  const topups = new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        async (...args: unknown[]) => {
          calls.push(typeof args[2] === 'string' ? `${name}:${args[2]}` : name);
          if (name === 'lookup' || name === 'confirm') calls.push(`code=${(args[1] as { code: string }).code}`);
          throw new DriverError('not_found');
        },
    },
  );
  const ctx = {
    auth: roles ? { sub: 'p1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    topups,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), calls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

describe('wallet top-up routes', () => {
  it('customers request and poll their own codes', async () => {
    const c = caller(['customer']);
    expect(await codeOf(c.call.wallet.requestTopUp({ amountIqd: 25_000 }))).toBe('NOT_FOUND');
    expect(await codeOf(c.call.wallet.topUpStatus({}))).toBe('NOT_FOUND');
    expect(c.calls).toEqual(['request', 'status']);
    expect(await codeOf(c.call.wallet.requestTopUp({ amountIqd: 2_000 }))).toBe('BAD_REQUEST');
    expect(await codeOf(caller(null).call.wallet.requestTopUp({ amountIqd: 25_000 }))).toBe('UNAUTHORIZED');
  });

  it('ops agents confirm through ops.*, couriers through partner.* — each with its channel; QR payloads are accepted', async () => {
    const ops = caller(['field_ops']);
    expect(await codeOf(ops.call.ops.topUpLookup({ code: 'DRVTU:123456' }))).toBe('NOT_FOUND');
    expect(await codeOf(ops.call.ops.confirmTopUp({ code: '123 456', amountIqd: 25_000 }))).toBe('NOT_FOUND');
    expect(ops.calls).toEqual(['lookup:ops_agent', 'code=123456', 'confirm:ops_agent', 'code=123456']);
    expect(await codeOf(ops.call.partner.confirmTopUp({ code: '123456', amountIqd: 25_000 }))).toBe('FORBIDDEN');

    const courier = caller(['courier']);
    expect(await codeOf(courier.call.partner.confirmTopUp({ code: '123456', amountIqd: 25_000 }))).toBe('NOT_FOUND');
    expect(courier.calls).toEqual(['confirm:courier', 'code=123456']);
    expect(await codeOf(courier.call.ops.confirmTopUp({ code: '123456', amountIqd: 25_000 }))).toBe('FORBIDDEN');
    expect(await codeOf(courier.call.partner.confirmTopUp({ code: '12345', amountIqd: 25_000 }))).toBe('BAD_REQUEST');

    expect(await codeOf(caller(['customer']).call.ops.topUpLookup({ code: '123456' }))).toBe('FORBIDDEN');
  });
});
