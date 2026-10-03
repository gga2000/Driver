import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  CancelOrderInput,
  CancellationFee,
  ListActiveOrdersInput,
  MerchantAcceptInput,
  MerchantHeartbeatInput,
  MerchantRejectInput,
  OpenDisputeInput,
  Order,
  OrderIdInput,
  PlaceOrderInput,
  RespondPartialInput,
} from '../order.js';
import { protectedProcedure, router } from '../trpc.js';

/** Merchant-side roles; the API additionally checks the role is scoped to the order's merchant org. */
export const MERCHANT_ROLES: readonly RoleKind[] = ['merchant_staff', 'merchant_owner'];
const BOARD_ROLES: readonly RoleKind[] = [...MERCHANT_ROLES, 'dispatcher', 'support', 'admin'];
const Ok = z.object({ ok: z.literal(true) });

/** Orders procedures (plan Step 4). Implementations live in `modules/orders` behind `ctx.orders`. */
export const ordersRouter = router({
  place: protectedProcedure().input(PlaceOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.place(ctx.actor, input)),
  get: protectedProcedure().input(OrderIdInput).output(Order).query(({ ctx, input }) => ctx.orders.get(ctx.actor, input)),
  mine: protectedProcedure().output(z.array(Order)).query(({ ctx }) => ctx.orders.mine(ctx.actor)),
  cancellationPreview: protectedProcedure()
    .input(OrderIdInput)
    .output(CancellationFee)
    .query(({ ctx, input }) => ctx.orders.cancellationPreview(ctx.actor, input)),
  cancel: protectedProcedure().input(CancelOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.cancel(ctx.actor, input)),
  respondPartial: protectedProcedure().input(RespondPartialInput).output(Order).mutation(({ ctx, input }) => ctx.orders.respondPartial(ctx.actor, input)),
  openDispute: protectedProcedure().input(OpenDisputeInput).output(Order).mutation(({ ctx, input }) => ctx.orders.openDispute(ctx.actor, input)),
  rate: protectedProcedure().input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.rate(ctx.actor, input)),
  /** Customer-side ride completion ("وصلت") at the locked quote (edge-case review B.24). */
  confirmRideArrived: protectedProcedure().input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.confirmRideArrived(ctx.actor, input)),
  listActive: protectedProcedure(BOARD_ROLES).input(ListActiveOrdersInput).output(z.array(Order)).query(({ ctx, input }) => ctx.orders.listActive(ctx.actor, input)),
  merchant: router({
    accept: protectedProcedure(MERCHANT_ROLES).input(MerchantAcceptInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantAccept(ctx.actor, input)),
    reject: protectedProcedure(MERCHANT_ROLES).input(MerchantRejectInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantReject(ctx.actor, input)),
    preparing: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markPreparing(ctx.actor, input)),
    ready: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markReady(ctx.actor, input)),
    heartbeat: protectedProcedure(MERCHANT_ROLES).input(MerchantHeartbeatInput).output(Ok).mutation(({ ctx, input }) => ctx.orders.merchantHeartbeat(ctx.actor, input)),
  }),
});
