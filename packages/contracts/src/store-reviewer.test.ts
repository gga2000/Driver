import { describe, expect, it } from 'vitest';
import type { SessionClaims } from './auth.js';
import { appRouter } from './router.js';
import { STORE_REVIEWER_WRITES, t, type AppContext } from './trpc.js';

const claims: SessionClaims = {
  sub: 'reviewer',
  sid: 's1',
  iss: 'driver-api',
  iat: 0,
  exp: 4_000_000_000,
};

/** A caller signed in as `personId`; the reviewer is `reviewer`. Records which service was reached. */
function caller(personId: string) {
  const reached: string[] = [];
  const ctx = {
    auth: { ...claims, sub: personId },
    authError: null,
    identity: {
      hasRole: async () => false,
      isStoreReviewer: async (id: string) => id === 'reviewer',
      updateProfile: async () => {
        reached.push('identity.updateProfile');
        return null;
      },
    },
    wallet: {
      claimPoints: async () => {
        reached.push('wallet.claimPoints');
        return null;
      },
    },
    rideHabits: { mine: async () => [] },
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), reached };
}

describe('store reviewer writes (BENCH-04)', () => {
  it('lists only real mutations', () => {
    const procedures = appRouter._def.procedures as Record<string, { _def: { type: string } }>;
    for (const path of STORE_REVIEWER_WRITES) {
      expect(procedures[path], path).toBeDefined();
      expect(procedures[path]!._def.type, path).toBe('mutation');
    }
  });

  it('stops the reviewer at any write off the list, before the service is reached', async () => {
    const { call, reached } = caller('reviewer');
    await expect(call.wallet.claimPoints()).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(call.wallet.claimPoints()).rejects.toMatchObject({
      cause: { code: 'service_paused' },
    });
    expect(reached).toEqual([]);
  });

  it('lets the reviewer make a listed write', async () => {
    const { call, reached } = caller('reviewer');
    await call.identity.updateProfile({ name: 'App Review' }).catch(() => undefined);
    expect(reached).toEqual(['identity.updateProfile']);
  });

  it('never stops anyone else', async () => {
    const { call, reached } = caller('p1');
    await call.wallet.claimPoints().catch(() => undefined);
    expect(reached).toEqual(['wallet.claimPoints']);
  });
});
