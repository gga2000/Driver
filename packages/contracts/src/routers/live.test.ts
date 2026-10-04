import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind, SessionClaims } from '../auth.js';
import { DriverError } from '../errors.js';
import type { LiveEvent, LiveStreamRequest } from '../live-io.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

const claims: SessionClaims = {
  sub: 'p1',
  sid: 's1',
  iss: 'driver-api',
  iat: 0,
  exp: 4_000_000_000,
};

/**
 * A caller whose `ctx.live.stream` records the request and runs its scope check, then yields hello.
 * `via`: the Bearer header (`auth`) or the SSE stream token (`liveAuth`).
 */
function caller(
  roles: readonly RoleKind[],
  opts: { via?: 'bearer' | 'stream' | 'none'; storeOf?: string; partyOf?: string[] } = {},
) {
  const requests: LiveStreamRequest[] = [];
  const checks: string[] = [];
  const via = opts.via ?? 'stream';
  const ctx = {
    auth: via === 'bearer' ? claims : null,
    authError: null,
    liveAuth: via === 'stream' ? claims : null,
    liveAuthError: via === 'none' ? 'session_expired' : null,
    identity: { hasRole: async (_: string, kind: RoleKind) => roles.includes(kind) },
    tracking: {
      track: async (actor: { personId: string }, input: { orderId: string }) => {
        checks.push(`track:${actor.personId}:${input.orderId}`);
        if (input.orderId !== 'mine') throw new DriverError('forbidden');
      },
    },
    merchant: {
      storeStatus: async (actor: { personId: string }, input: { merchantOrgId: string }) => {
        checks.push(`store:${actor.personId}:${input.merchantOrgId}`);
        if (input.merchantOrgId !== opts.storeOf) throw new DriverError('forbidden');
      },
    },
    chat: { threads: async () => (opts.partyOf ?? []).map((kind) => ({ kind })) },
    orders: { mine: async () => [] },
    live: {
      token: async () => ({ token: 'tok', expiresAt: new Date(0) }),
      async *stream(req: LiveStreamRequest): AsyncGenerator<LiveEvent> {
        requests.push(req);
        await req.check();
        yield { type: 'hello', channels: [...req.channels], serverNow: new Date(0) };
      },
    },
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), requests, checks };
}

async function first(p: Promise<AsyncIterable<unknown>>): Promise<unknown> {
  const it = (await p)[Symbol.asyncIterator]();
  try {
    return (await it.next()).value;
  } finally {
    await it.return?.();
  }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

describe('live.* scoping (same checks as the matching queries)', () => {
  it('a courier’s partner stream is his own channel — there is no input to name another', async () => {
    const c = caller(['courier']);
    expect(await first(c.call.live.partner())).toMatchObject({
      type: 'hello',
      channels: ['driver:p1'],
    });
    expect(c.requests[0]!.channels).toEqual(['driver:p1']);
    expect(await codeOf(caller(['customer']).call.live.partner())).toBe('FORBIDDEN');
  });

  it('merchant staff: only a store their role is scoped to (merchant.storeStatus check)', async () => {
    const c = caller(['merchant_staff'], { storeOf: 'm1' });
    expect(await first(c.call.live.merchantBoard({ merchantOrgId: 'm1' }))).toMatchObject({
      channels: ['merchant:m1'],
    });
    expect(await codeOf(first(c.call.live.merchantBoard({ merchantOrgId: 'm2' })))).toBe(
      'FORBIDDEN',
    );
    expect(c.checks).toEqual(['store:p1:m1', 'store:p1:m2']);
    expect(
      await codeOf(caller(['customer']).call.live.merchantBoard({ merchantOrgId: 'm1' })),
    ).toBe('FORBIDDEN');
  });

  it('order stream: orders.track’s owner check; chat stream: a party of that thread kind', async () => {
    const c = caller(['customer'], { partyOf: ['customer_courier'] });
    expect(await first(c.call.live.order({ orderId: 'mine' }))).toMatchObject({
      channels: ['order:mine'],
    });
    expect(await codeOf(first(c.call.live.order({ orderId: 'theirs' })))).toBe('FORBIDDEN');
    expect(
      await first(c.call.live.chat({ orderId: 'mine', kind: 'customer_courier' })),
    ).toMatchObject({ channels: ['chat:mine:customer_courier'] });
    expect(
      await codeOf(first(c.call.live.chat({ orderId: 'mine', kind: 'merchant_courier' }))),
    ).toBe('FORBIDDEN');
  });

  it('console board: back-office read roles only; its city plus the city-less pins', async () => {
    expect(
      await first(caller(['dispatcher']).call.live.consoleBoard({ cityId: 'aziziyah' })),
    ).toMatchObject({ channels: ['city:aziziyah', 'city:*'] });
    expect(await codeOf(caller(['courier']).call.live.consoleBoard({ cityId: 'aziziyah' }))).toBe(
      'FORBIDDEN',
    );
  });

  it('auth: a stream token opens live.* only; without one the reason comes back (401)', async () => {
    expect(await codeOf(caller([], { via: 'none' }).call.live.order({ orderId: 'mine' }))).toBe(
      'UNAUTHORIZED',
    );
    // The stream token never authenticates an ordinary procedure.
    expect(await codeOf(caller(['customer'], { via: 'stream' }).call.orders.mine())).toBe(
      'UNAUTHORIZED',
    );
    // live.token itself needs the Bearer token.
    expect(await codeOf(caller(['customer'], { via: 'stream' }).call.live.token())).toBe(
      'UNAUTHORIZED',
    );
    expect(await caller(['customer'], { via: 'bearer' }).call.live.token()).toMatchObject({
      token: 'tok',
    });
    // Bearer works for streams too (server-side clients, tests).
    expect(
      await first(caller(['customer'], { via: 'bearer' }).call.live.order({ orderId: 'mine' })),
    ).toMatchObject({ type: 'hello' });
  });
});
