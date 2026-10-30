import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind } from '../auth.js';
import { DriverError } from '../errors.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

/** `ctx.orders` that records which method a procedure reached, then answers "not found". */
function caller(roles: readonly RoleKind[]) {
  const calls: string[] = [];
  const orders = new Proxy(
    {},
    {
      get: (_t, name: string) => async () => {
        calls.push(name);
        throw new DriverError('not_found');
      },
    },
  );
  const ctx = {
    auth: { sub: 'p1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 },
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => roles.includes(kind) },
    orders,
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

const INPUT = { orderId: 'o1', totalIqd: 18_750, reason: 'الصورة ما دتنرسل من السوق' };

describe('orders.ops.recordErrandReceipt («دوّرلي» receipt by staff)', () => {
  it('dispatchers, support and admins reach it; couriers, customers and finance do not', async () => {
    for (const role of ['dispatcher', 'support', 'admin'] as const) {
      const c = caller([role]);
      expect(await codeOf(c.call.orders.ops.recordErrandReceipt(INPUT))).toBe('NOT_FOUND');
      expect(c.calls).toEqual(['opsErrandReceipt']);
    }
    for (const role of ['courier', 'customer', 'finance'] as const) {
      const c = caller([role]);
      expect(await codeOf(c.call.orders.ops.recordErrandReceipt(INPUT))).toBe('FORBIDDEN');
      expect(c.calls).toEqual([]);
    }
  });

  it('needs a positive whole amount and a reason; the photo is optional', async () => {
    const c = caller(['dispatcher']);
    expect(await codeOf(c.call.orders.ops.recordErrandReceipt({ ...INPUT, totalIqd: 0 }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.orders.ops.recordErrandReceipt({ ...INPUT, totalIqd: 100.5 }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.orders.ops.recordErrandReceipt({ ...INPUT, reason: 'x' }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.orders.ops.recordErrandReceipt({ ...INPUT, photoUploadId: null }))).toBe('NOT_FOUND');
    expect(await codeOf(c.call.orders.ops.recordErrandReceipt({ ...INPUT, photoUploadId: 'up_1' }))).toBe('NOT_FOUND');
    expect(c.calls).toEqual(['opsErrandReceipt', 'opsErrandReceipt']);
  });
});
