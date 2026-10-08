import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { describe, expect, it } from 'vitest';
import { DriverError } from './errors.js';
import { protectedProcedure, publicProcedure, router, t, type AppContext } from './trpc.js';

const appRouter = router({
  taken: publicProcedure.mutation(() => {
    throw new DriverError('offer_taken');
  }),
  devOnly: publicProcedure.query(() => {
    throw new DriverError('dev_only');
  }),
  missing: protectedProcedure().query(() => {
    throw new DriverError('dispatch_not_found');
  }),
  boom: publicProcedure.query(() => {
    throw new Error('kaboom');
  }),
});

const ctx = {
  auth: { sub: 'p1', sid: 's1' },
  authError: null,
  identity: { hasRole: async () => true },
} as unknown as AppContext;

async function failure(p: Promise<unknown>): Promise<TRPCError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return err as TRPCError;
}

describe('procedures map DriverError to its HTTP status (tRPC v11 returns results from next(), it does not throw)', () => {
  const caller = t.createCallerFactory(appRouter)(ctx);

  it('offer_taken → CONFLICT / 409, DriverError kept as the cause', async () => {
    const err = await failure(caller.taken());
    expect(err.code).toBe('CONFLICT');
    expect(getHTTPStatusCodeFromError(err)).toBe(409);
    expect(err.cause).toBeInstanceOf(DriverError);
  });

  it('dev_only → FORBIDDEN / 403', async () => {
    expect(getHTTPStatusCodeFromError(await failure(caller.devOnly()))).toBe(403);
  });

  it('through protectedProcedure too: dispatch_not_found → 404', async () => {
    expect(getHTTPStatusCodeFromError(await failure(caller.missing()))).toBe(404);
  });

  it('anything that is not a DriverError stays a 500', async () => {
    expect(getHTTPStatusCodeFromError(await failure(caller.boom()))).toBe(500);
  });
});

describe('role gate reads roles once per request (CON-21)', () => {
  const gated = router({
    a: protectedProcedure(['dispatcher', 'support', 'admin']).query(() => 'a'),
    b: protectedProcedure(['finance', 'admin']).query(() => 'b'),
    c: protectedProcedure(['finance']).query(() => 'c'),
  });
  const make = (roles: string[]) => {
    let reads = 0;
    const identity = {
      hasRole: async () => {
        throw new Error('the gate should use activeRoles');
      },
      activeRoles: async () => {
        reads += 1;
        return roles;
      },
    };
    return { identity, reads: () => reads };
  };

  it('a batch of calls in one request costs one roles read, and a missing role is still refused', async () => {
    const id = make(['admin']);
    const caller = t.createCallerFactory(gated)({ auth: { sub: 'p1', sid: 's1' }, authError: null, identity: id.identity } as unknown as AppContext);
    await expect(Promise.all([caller.a(), caller.b(), caller.a()])).resolves.toEqual(['a', 'b', 'a']);
    expect(id.reads()).toBe(1);
    expect(getHTTPStatusCodeFromError(await failure(caller.c()))).toBe(403);
    expect(id.reads()).toBe(1);
  });

  it('the next request reads again, so a revoked role stops working at once', async () => {
    const roles = ['finance'];
    const id = make(roles);
    const request = () => t.createCallerFactory(gated)({ auth: { sub: 'p1', sid: 's1' }, authError: null, identity: id.identity } as unknown as AppContext);
    await expect(request().c()).resolves.toBe('c');
    roles.length = 0;
    expect(getHTTPStatusCodeFromError(await failure(request().c()))).toBe(403);
    expect(id.reads()).toBe(2);
  });
});
