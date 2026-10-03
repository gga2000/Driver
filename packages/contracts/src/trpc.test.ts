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
