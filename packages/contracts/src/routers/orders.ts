import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  CancelOrderInput,
  CancellationFee,
  ComingOutResult,
  ListActiveOrdersInput,
  MerchantAcceptInput,
  MerchantExtendPrepInput,
  MerchantHandOverInput,
  MerchantHeartbeatInput,
  MerchantRejectInput,
  OpenDisputeInput,
  Order,
  OrderIdInput,
  OrderQuote,
  PlaceOrderInput,
  RateOrderInput,
  RespondPartialInput,
  RideSwitchQuote,
  RideSwitchQuoteInput,
  SwitchRideVehicleInput,
} from '../order.js';
import { TipOffer, TipOrderInput, TipResult } from '../order-tip.js';
import { ComplimentInput, ComplimentOffer, ComplimentResult } from '../order-compliment.js';
import { Usual } from '../habits-io.js';
import { CourierPosition, OrderFirsts, OrderHistoryRow, OrderRoute, OrderTracking } from '../tracking.js';
import { AtRiskInput, AtRiskOrder, EventLog, OrderLedgerLine, OrderReplay, OrderSearchInput, OrderSearchPage } from '../console-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';
import { SUPPORT_DESK_ROLES } from './support.js';
import { CashStanding, ResolveDisputeInput, StaffActionResult, StaffCancelOrderInput, StaffChargeCourierInput, StaffCloseOrderInput, StaffCourierLostInput, StaffMarkDeliveredInput, StuckOrder, StuckOrdersInput } from '../order-staff-io.js';

/** Merchant-side roles; the API additionally checks the role is scoped to the order's merchant org. */
export const MERCHANT_ROLES: readonly RoleKind[] = ['merchant_staff', 'merchant_owner'];
const BOARD_ROLES: readonly RoleKind[] = [...MERCHANT_ROLES, 'dispatcher', 'support', 'admin'];
const Ok = z.object({ ok: z.literal(true) });
/** W3: who may end a stuck order (cancel, mark delivered, close, courier lost). */
export const ORDER_OPS_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];
/** W3 M-10: charging a courier the lost food is confirmed by dispatch or finance. */
export const ORDER_CHARGE_ROLES: readonly RoleKind[] = ['dispatcher', 'finance', 'admin'];

/** Orders procedures (plan Step 4). Implementations live in `modules/orders` behind `ctx.orders`. */
export const ordersRouter = router({
  place: protectedProcedure().input(PlaceOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.place(ctx.actor, input)),
  /** Checkout summary: the server's would-be charge for this input (merchant deal applied), nothing stored. */
  quote: protectedProcedure().input(PlaceOrderInput).output(OrderQuote).query(({ ctx, input }) => ctx.orders.quote(ctx.actor, input)),
  get: protectedProcedure().input(OrderIdInput).output(Order).query(({ ctx, input }) => ctx.orders.get(ctx.actor, input)),
  mine: protectedProcedure().output(z.array(Order)).query(({ ctx }) => ctx.orders.mine(ctx.actor)),
  /** طلباتي (audit C-15): own orders newest first with the restaurant's name and the dishes (one read for the list). */
  history: protectedProcedure().output(z.array(OrderHistoryRow)).query(({ ctx }) => ctx.tracking.history(ctx.actor)),
  /** «أول مرة» (joy g8): the person's first delivered meal and first tuktuk ride, once in a lifetime. */
  firsts: protectedProcedure().output(OrderFirsts).query(({ ctx }) => ctx.tracking.firsts(ctx.actor)),
  /** «طلبك المعتاد؟» (joy s3): the person's usuals from their own delivered orders, each with the reason. */
  usuals: protectedProcedure().output(z.array(Usual)).query(({ ctx }) => ctx.tracking.usuals(ctx.actor)),
  cancellationPreview: protectedProcedure()
    .input(OrderIdInput)
    .output(CancellationFee)
    .query(({ ctx, input }) => ctx.orders.cancellationPreview(ctx.actor, input)),
  cancel: protectedProcedure().input(CancelOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.cancel(ctx.actor, input)),
  respondPartial: protectedProcedure().input(RespondPartialInput).output(Order).mutation(({ ctx, input }) => ctx.orders.respondPartial(ctx.actor, input)),
  openDispute: protectedProcedure().input(OpenDisputeInput).output(Order).mutation(({ ctx, input }) => ctx.orders.openDispute(ctx.actor, input)),
  /** Never closes the order (FLOW-20: the 2-h complaint window stays open); `delivery` / `food` (1–5), tags and a note store the two-tap rating (food only on kitchen orders). */
  rate: protectedProcedure().input(RateOrderInput).output(Order).mutation(({ ctx, input }) => ctx.orders.rate(ctx.actor, input)),
  /** «تحب تكرم عباس؟» after a 4–5 rating: whether to ask and the wallet chips (docs/api/tips.md). */
  tipOptions: protectedProcedure().input(OrderIdInput).output(TipOffer).query(({ ctx, input }) => ctx.orders.tipOptions(ctx.actor, input)),
  /** The tip after the rating: wallet → driver, 100 %, once per order, server-checked. */
  tip: protectedProcedure().input(TipOrderInput).output(TipResult).mutation(({ ctx, input }) => ctx.orders.tip(ctx.actor, input)),
  /** «شنو عجبك بـ حيدر؟» after a 4–5 rating: whether to ask and which words (docs/api/compliments-and-live.md). */
  complimentOptions: protectedProcedure().input(OrderIdInput).output(ComplimentOffer).query(({ ctx, input }) => ctx.orders.complimentOptions(ctx.actor, input)),
  /** The kind words for the courier/driver: once per order, the orderer only, no money. */
  compliment: protectedProcedure().input(ComplimentInput).output(ComplimentResult).mutation(({ ctx, input }) => ctx.orders.compliment(ctx.actor, input)),
  /** Customer live screen (spec §4): own order + trip summary + courier card. Orderer or participant only. */
  track: protectedProcedure().input(OrderIdInput).output(OrderTracking).query(({ ctx, input }) => ctx.tracking.track(ctx.actor, input)),
  /** Courier's last fix for the customer, only between accept and complete (null otherwise). Polled every 2 s. */
  courierPosition: protectedProcedure()
    .input(OrderIdInput)
    .output(CourierPosition.nullable())
    .query(({ ctx, input }) => ctx.tracking.courierPosition(ctx.actor, input)),
  /** The road the courier still drives for this order (refetched when he strays from it). */
  route: protectedProcedure().input(OrderIdInput).output(OrderRoute).query(({ ctx, input }) => ctx.tracking.route(ctx.actor, input)),
  /** Customer-side ride completion ("وصلت") at the locked quote (edge-case review B.24). */
  confirmRideArrived: protectedProcedure().input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.confirmRideArrived(ctx.actor, input)),
  /** «أني نازل» at the door: 2 more free minutes before the courier may leave, once (J-D8). */
  comingOut: protectedProcedure().input(OrderIdInput).output(ComingOutResult).mutation(({ ctx, input }) => ctx.orders.comingOut(ctx.actor, input)),
  /** J-D7: no driver after 3 minutes — the other vehicle at a fresh server quote (the orderer only). */
  rideSwitchQuote: protectedProcedure().input(RideSwitchQuoteInput).output(RideSwitchQuote).query(({ ctx, input }) => ctx.orders.rideSwitchQuote(ctx.actor, input)),
  switchRideVehicle: protectedProcedure().input(SwitchRideVehicleInput).output(Order).mutation(({ ctx, input }) => ctx.orders.switchRideVehicle(ctx.actor, input)),
  /** Console history: any state, newest first, keyset-paginated. */
  search: protectedProcedure(CONSOLE_READ_ROLES).input(OrderSearchInput).output(OrderSearchPage).query(({ ctx, input }) => ctx.console.searchOrders(input)),
  /** The order's actor event log (quarantined late replays included and marked). */
  events: protectedProcedure(CONSOLE_READ_ROLES).input(OrderIdInput).output(EventLog).query(({ ctx, input }) => ctx.console.orderEvents(input.orderId)),
  /** The courier's path and the order's moments, for the Console replay (maps program o2). */
  replay: protectedProcedure(CONSOLE_READ_ROLES).input(OrderIdInput).output(OrderReplay).query(({ ctx, input }) => ctx.console.orderReplay(input.orderId)),
  /** Live orders predicted to be late before they are (maps program o4). */
  atRisk: protectedProcedure(CONSOLE_READ_ROLES).input(AtRiskInput).output(z.array(AtRiskOrder)).query(({ ctx, input }) => ctx.tracking.atRisk(input.cityId)),
  /** The order's ledger lines (Console order page: the money in words). */
  ledger: protectedProcedure(CONSOLE_READ_ROLES)
    .input(OrderIdInput)
    .output(z.array(OrderLedgerLine))
    .query(({ ctx, input }) => ctx.console.orderLedger(input.orderId)),
  listActive: protectedProcedure(BOARD_ROLES).input(ListActiveOrdersInput).output(z.array(Order)).query(({ ctx, input }) => ctx.orders.listActive(ctx.actor, input)),
  /** W3 (M-3/M-4): his unpaid fees and open cash orders, and whether a cash order would be taken now. */
  cashStanding: protectedProcedure().output(CashStanding).query(({ ctx }) => ctx.orders.cashStanding(ctx.actor)),
  /** W3 staff way-out (docs/api/staff-ops.md): every action takes a reason and writes the Console audit log. */
  ops: router({
    /** Cancel a live order before pickup: free for the customer (platform_cancelled), or his normal fee when he asked. */
    cancel: protectedProcedure(ORDER_OPS_ROLES).input(StaffCancelOrderInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsCancel(ctx.actor, input)),
    /** The courier handed it over but his app did not record it: picked_up → delivered (cash as collected). */
    markDelivered: protectedProcedure(ORDER_OPS_ROLES).input(StaffMarkDeliveredInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsMarkDelivered(ctx.actor, input)),
    /** Close a delivered order (or completed ride) now: money settles as on the 2-h auto-close. */
    close: protectedProcedure(ORDER_OPS_ROLES).input(StaffCloseOrderInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsClose(ctx.actor, input)),
    /** NTF-13: the courier disappeared with the food; never re-dispatched. The refund is behind `COURIER_LOST_REFUND`. */
    courierLost: protectedProcedure(ORDER_OPS_ROLES).input(StaffCourierLostInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsCourierLost(ctx.actor, input)),
    /** M-10 second step: the lost food's cost on the courier's cash account (behind `COURIER_LOST_CHARGE`). */
    chargeCourier: protectedProcedure(ORDER_CHARGE_ROLES).input(StaffChargeCourierInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsChargeCourier(ctx.actor, input)),
    /** NTF-01 / M-1: end a complaint — stands, full or part refund, resend, or void (behind `DISPUTE_OUTCOMES`). */
    resolveDispute: protectedProcedure(SUPPORT_DESK_ROLES).input(ResolveDisputeInput).output(StaffActionResult).mutation(({ ctx, input }) => ctx.orders.opsResolveDispute(ctx.actor, input)),
    /** Orders stuck past their state's deadline, oldest first, with the actions that apply. */
    stuck: protectedProcedure(CONSOLE_READ_ROLES).input(StuckOrdersInput).output(z.array(StuckOrder)).query(({ ctx, input }) => ctx.orders.opsStuck(ctx.actor, input)),
  }),
  merchant: router({
    accept: protectedProcedure(MERCHANT_ROLES).input(MerchantAcceptInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantAccept(ctx.actor, input)),
    reject: protectedProcedure(MERCHANT_ROLES).input(MerchantRejectInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantReject(ctx.actor, input)),
    preparing: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markPreparing(ctx.actor, input)),
    ready: protectedProcedure(MERCHANT_ROLES).input(OrderIdInput).output(Order).mutation(({ ctx, input }) => ctx.orders.markReady(ctx.actor, input)),
    heartbeat: protectedProcedure(MERCHANT_ROLES).input(MerchantHeartbeatInput).output(Ok).mutation(({ ctx, input }) => ctx.orders.merchantHeartbeat(ctx.actor, input)),
    /** "+5 د" once per accepted order: moves the promised ready time and tells the customer. */
    extendPrep: protectedProcedure(MERCHANT_ROLES).input(MerchantExtendPrepInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantExtendPrep(ctx.actor, input)),
    /** "سلّمته" (S-M4): the kitchen handed the bag to the courier at the pass; idempotent, no state change. */
    handOver: protectedProcedure(MERCHANT_ROLES).input(MerchantHandOverInput).output(Order).mutation(({ ctx, input }) => ctx.orders.merchantHandOver(ctx.actor, input)),
  }),
});
