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
  OrderQuote,
  PlaceOrderInput,
  RateOrderInput,
  RespondPartialInput,
} from '../order.js';
import { CourierPosition, OrderTracking } from '../tracking.js';
import { EventLog, OrderSearchInput, OrderSearchPage } from '../console-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';

/** Merchant-side roles; the API additionally checks the role is scoped to the order's merchant org. */
export const MERCHANT_ROLES: readonly RoleKind[] = ['merchant_staff', 'merchant_owner'];
const BOARD_ROLES: readonly RoleKind[] = [...MERCHANT_ROLES, 'dispatcher', 'support', 'admin'];
const Ok = z.object({ ok: z.literal(true) });

/** Orders procedures (plan Step 4). Implementations live in `modules/orders` behind `ctx.orders`. */
export const ordersRouter = router({
  place: protectedProcedure().input(PlaceOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.place(ctx.actor, input)),
  /** Checkout summary: the server's would-be charge for this input (merchant deal applied), nothing stored. */
  quote: protectedProcedure().input(PlaceOrderInput).output(OrderQuote).query(({ ctx, input }) => ctx.orders.quote(ctx.actor, input)),
  get: protectedProcedure().input(OrderIdInput).output(Order).query(({ ctx, input }) => ctx.orders.get(ctx.actor, input)),
  mine: protectedProcedure().output(z.array(Order)).query(({ ctx }) => ctx.orders.mine(ctx.actor)),
  cancellationPreview: protectedProcedure()
    .input(OrderIdInput)
    .output(CancellationFee)
    .query(({ ctx, input }) => ctx.orders.cancellationPreview(ctx.actor, input)),
  cancel: protectedProcedure().input(CancelOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.cancel(ctx.actor, input)),
  respondPartial: protectedProcedure().input(RespondPartialInput).output(Order).mutation(({ ctx, input }) => ctx.orders.respondPartial(ctx.actor, input)),
  openDispute: protectedProcedure().input(OpenDisputeInput).output(Order).mutation(({ ctx, input }) => ctx.orders.openDispute(ctx.actor, input)),
  /** Closes early; `delivery` / `food` (1–5), tags and a note store the two-tap rating (food only on kitchen orders). */
  rate: protectedProcedure().input(RateOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.rate(ctx.actor, input)),
  /** Customer live screen (spec §4): own order + trip summary + courier card. Orderer or participant only. */
  track: protectedProcedure().input(OrderIdInput).output(OrderTracking).query(({ ctx, input }) => ctx.tracking.track(ctx.actor, input)),
  /** Courier's last fix for the customer, only between accept and complete (null otherwise). Polled every 2 s. */
  courierPosition: protectedProcedure()
    .input(OrderIdInput)
    .output(CourierPosition.nullable())
    .query(({ ctx, input }) => ctx.tracking.courierPosition(ctx.actor, input)),
  /** Customer-side ride completion ("وصلت") at the locked quote (edge-case review B.24). */
  confirmRideArrived: protectedProcedure().input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.confirmRideArrived(ctx.actor, input)),
  /** Console history: any state, newest first, keyset-paginated. */
  search: protectedProcedure(CONSOLE_READ_ROLES).input(OrderSearchInput).output(OrderSearchPage).query(({ ctx, input }) => ctx.console.searchOrders(input)),
  /** The order's actor event log (quarantined late replays included and marked). */
  events: protectedProcedure(CONSOLE_READ_ROLES).input(OrderIdInput).output(EventLog).query(({ ctx, input }) => ctx.console.orderEvents(input.orderId)),
  listActive: protectedProcedure(BOARD_ROLES).input(ListActiveOrdersInput).output(z.array(Order)).query(({ ctx, input }) => ctx.orders.listActive(ctx.actor, input)),
  merchant: router({
    accept: protectedProcedure(MERCHANT_ROLES).input(MerchantAcceptInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantAccept(ctx.actor, input)),
    reject: protectedProcedure(MERCHANT_ROLES).input(MerchantRejectInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantReject(ctx.actor, input)),
    preparing: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markPreparing(ctx.actor, input)),
    ready: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markReady(ctx.actor, input)),
    heartbeat: protectedProcedure(MERCHANT_ROLES).input(MerchantHeartbeatInput).output(Ok).mutation(({ ctx, input }) => ctx.orders.merchantHeartbeat(ctx.actor, input)),
  }),
});
