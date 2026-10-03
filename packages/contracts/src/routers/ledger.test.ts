import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind } from '../auth.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

/** The caller holds `kind` scoped to `orgId`; the ledger port records what reached it. */
function caller(kind: RoleKind, orgId: string | null) {
  const calls: string[] = [];
  const ctx = {
    auth: { sub: 'p1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 },
    authError: null,
    identity: { hasRole: async (_: string, k: RoleKind, org?: string) => k === kind && (org === undefined || org === orgId) },
    ledger: {
      merchantBalance: async (merchantId: string) => {
        calls.push('merchantBalance');
        return { merchantId, balanceIqd: 120_000, mode: 'nightly_courier', exposureCapIqd: 300_000, overExposure: false, holders: [], lastSettledAt: null, lastRequestedAt: null };
      },
      requestSettlement: async (input: { merchantId: string }) => {
        calls.push('requestSettlement');
        return { merchantId: input.merchantId, amountIqd: 120_000, channel: 'ops_round', reference: 'M-AAAA-BBBB', targetBy: new Date(), reason: 'merchant_request' };
      },
    },
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), calls };
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return err instanceof TRPCError ? err.code : null;
}

describe('ledger merchant money is owner-only (review 2026-10-04 #3)', () => {
  it('a merchant staff member cannot read the cash balance or ask for the money', async () => {
    const staff = caller('merchant_staff', 'org_1');
    expect(await codeOf(staff.call.ledger.merchantBalance({ merchantId: 'org_1' }))).toBe('FORBIDDEN');
    expect(await codeOf(staff.call.ledger.requestSettlement({ merchantId: 'org_1' }))).toBe('FORBIDDEN');
    expect(staff.calls).toEqual([]);
  });

  it("the owner can, but only for his own store", async () => {
    const owner = caller('merchant_owner', 'org_1');
    expect(await codeOf(owner.call.ledger.merchantBalance({ merchantId: 'org_1' }))).toBeNull();
    expect(await codeOf(owner.call.ledger.requestSettlement({ merchantId: 'org_1' }))).toBeNull();
    expect(await codeOf(owner.call.ledger.merchantBalance({ merchantId: 'org_2' }))).toBe('FORBIDDEN');
    expect(owner.calls).toEqual(['merchantBalance', 'requestSettlement']);
  });

  it('back office still reads any merchant', async () => {
    const finance = caller('finance', null);
    expect(await codeOf(finance.call.ledger.merchantBalance({ merchantId: 'org_9' }))).toBeNull();
  });
});
