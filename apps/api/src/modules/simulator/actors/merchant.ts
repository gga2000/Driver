import type { Order } from '@driver/contracts';
import type { OrderRun, RestaurantRun, SimContext } from '../context.js';

/**
 * Kitchen behaviour (plan Step 7): accepts in 10–80 s, prep 8–25 min; which orders it rejects (3 %)
 * or partially accepts (2 %) is in the plan (`PlannedOrder.kitchen`).
 */
export const MERCHANT_BEHAVIOUR = {
  acceptDelaySec: [10, 80] as const,
  prepMin: [8, 25] as const,
  /** Real readiness against the promise: a little early to a little late. */
  prepNoiseMin: [-3, 2] as const,
  heartbeatEverySec: 30,
};

/** Merchant-app heartbeat (review A.2): a present kitchen never has its courier released. */
export async function merchantHeartbeats(ctx: SimContext): Promise<void> {
  for (const r of ctx.restaurants) {
    if (ctx.t < r.nextHeartbeatT) continue;
    r.nextHeartbeatT = ctx.t + MERCHANT_BEHAVIOUR.heartbeatEverySec * 1000;
    await ctx.call('merchant.heartbeat', () => ctx.s.orders.merchantHeartbeat(r.orgId));
  }
}

/** One kitchen step for one food order, given the order as the Merchant app sees it now. */
export async function merchantStep(ctx: SimContext, run: OrderRun, order: Order): Promise<void> {
  const r = run.restaurant;
  if (!r || !run.orderId) return;
  const staff = r.ownerId;
  const rand = run.rand;

  if (order.state === 'placed' && order.merchantOfferedAt && !order.partial) {
    if (run.offerSeenT === null) {
      run.offerSeenT = ctx.t;
      run.decision = run.plan.kitchen === 'partial' && order.lines.length < 2 ? 'accept' : run.plan.kitchen;
      run.decideAt = ctx.t + rand.int(...MERCHANT_BEHAVIOUR.acceptDelaySec) * 1000;
      run.prepMin = rand.int(...MERCHANT_BEHAVIOUR.prepMin);
    }
    if (run.decideAt !== null && ctx.t >= run.decideAt) {
      run.decideAt = null;
      const prepMinutes = Math.max(1, Math.round(ctx.appDelaySec(run.prepMin * 60) / 60));
      if (run.decision === 'reject') {
        await ctx.call('merchant.reject', () => ctx.s.orders.merchantReject(staff, { orderId: run.orderId!, reason: 'busy' }));
      } else if (run.decision === 'partial') {
        const out = order.lines[order.lines.length - 1]!;
        await ctx.call('merchant.partial', () => ctx.s.orders.merchantAccept(staff, { orderId: run.orderId!, prepMinutes, unavailableLineIds: [out.id] }));
      } else {
        await ctx.call('merchant.accept', () => ctx.s.orders.merchantAccept(staff, { orderId: run.orderId!, prepMinutes }));
      }
    }
    return;
  }

  if (order.state === 'merchant_accepted' || order.state === 'preparing') {
    if (run.acceptedT === null) {
      run.acceptedT = ctx.t;
      // Auto-accepted orders never reached the kitchen's screen as "new": they cook to the default prep.
      if (run.offerSeenT === null) run.prepMin = r.def.defaultPrepMin;
      const prepSim = Math.max(3, run.prepMin + rand.range(...MERCHANT_BEHAVIOUR.prepNoiseMin));
      run.readyT = ctx.t + prepSim * 60_000;
      run.preparingAt = ctx.t + rand.int(30, 150) * 1000;
    }
    if (order.state === 'merchant_accepted' && run.preparingAt !== null && ctx.t >= run.preparingAt) {
      run.preparingAt = null;
      await ctx.call('merchant.preparing', () => ctx.s.orders.markPreparing(staff, { orderId: run.orderId! }));
    }
    if (run.readyT !== null && ctx.t >= run.readyT) {
      await ctx.call('merchant.ready', () => ctx.s.orders.markReady(staff, { orderId: run.orderId! }));
    }
  }
}

export function restaurantOf(ctx: SimContext, orgId: string): RestaurantRun | undefined {
  return ctx.restaurants.find((r) => r.orgId === orgId);
}
