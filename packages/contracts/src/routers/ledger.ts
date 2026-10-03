import type { RoleKind } from '../auth.js';
import { DriverError } from '../errors.js';
import {
  DriverLedgerInput,
  DriverLedgerView,
  MerchantBalanceInput,
  MerchantBalanceView,
  NightlyReport,
  RequestSettlementInput,
  SettlementPlan,
} from '../ledger-io.js';
import type { AppContext } from '../trpc.js';
import { protectedProcedure, router, toTrpcError } from '../trpc.js';

/** Back-office roles that may read any driver's or merchant's book. */
const BACK_OFFICE: readonly RoleKind[] = ['finance', 'admin', 'dispatcher', 'support'];
const MERCHANT_ROLES: readonly RoleKind[] = ['merchant_owner', 'merchant_staff'];

async function hasAny(ctx: AppContext, personId: string, roles: readonly RoleKind[], orgId?: string): Promise<boolean> {
  for (const kind of roles) {
    if (await ctx.identity.hasRole(personId, kind, orgId)) return true;
  }
  return false;
}

/**
 * Errors thrown inside a resolver reach tRPC as INTERNAL unless converted here (the shared
 * `publicProcedure` try/catch only sees middleware errors), so every resolver runs through this.
 */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toTrpcError(err);
  }
}

/** A merchant's staff (scoped to that org) or back office. */
async function assertMerchantAccess(ctx: AppContext, personId: string, merchantId: string): Promise<void> {
  if (await hasAny(ctx, personId, MERCHANT_ROLES, merchantId)) return;
  if (await hasAny(ctx, personId, BACK_OFFICE)) return;
  throw new DriverError('forbidden');
}

/** Ledger procedures (plan Step 6). Every call goes through `ctx.ledger`, the API's port. */
export const ledgerRouter = router({
  /** A driver reads his own book; back office reads anyone's. */
  driverLedger: protectedProcedure()
    .input(DriverLedgerInput)
    .output(DriverLedgerView)
    .query(({ ctx, input }) =>
      guarded(async () => {
        const driverId = input.driverId ?? ctx.actor.personId;
        if (driverId !== ctx.actor.personId && !(await hasAny(ctx, ctx.actor.personId, BACK_OFFICE))) throw new DriverError('forbidden');
        return ctx.ledger.driverLedger({ driverId, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}) });
      }),
    ),
  merchantBalance: protectedProcedure()
    .input(MerchantBalanceInput)
    .output(MerchantBalanceView)
    .query(({ ctx, input }) =>
      guarded(async () => {
        await assertMerchantAccess(ctx, ctx.actor.personId, input.merchantId);
        return ctx.ledger.merchantBalance(input.merchantId);
      }),
    ),
  /** "اطلب فلوسك" (decisions §3). */
  requestSettlement: protectedProcedure()
    .input(RequestSettlementInput)
    .output(SettlementPlan)
    .mutation(({ ctx, input }) =>
      guarded(async () => {
        await assertMerchantAccess(ctx, ctx.actor.personId, input.merchantId);
        return ctx.ledger.requestSettlement({ merchantId: input.merchantId, requestedBy: ctx.actor.personId });
      }),
    ),
  /** "تشغيل الإقفال الليلي" on the Console system page. */
  runNightly: protectedProcedure(['finance', 'admin'])
    .output(NightlyReport)
    .mutation(({ ctx }) => guarded(() => ctx.ledger.runNightly({ requestedBy: ctx.actor.personId }))),
});
