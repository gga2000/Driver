import { PriceRequest, type Order } from '@driver/contracts';
import { CITY, type OrderRun, type SimContext } from '../context.js';
import { zoneAt } from '../world.js';

/** Customer behaviour: places food and ride orders, cancels at random stages (~5 %), answers partial proposals. */
export const CUSTOMER_BEHAVIOUR = {
  partialApprove: 0.7,
  partialDecline: 0.2,
  /** A ride nobody took: half cancel as soon as it is free (180 s), everyone gives up at 12 min. */
  rideFreeCancel: 0.5,
  ridePatienceMin: 12,
  /** Food with no courier this long after it is ready: the customer cancels. */
  foodPatienceAfterReadyMin: 30,
};

/** Places the planned order through `orders.place` (rides also get their trip and a broadcast request). */
export async function placeOrder(ctx: SimContext, run: OrderRun): Promise<void> {
  const p = run.plan;
  const c = ctx.world.customers[p.customer]!;
  run.placedT = ctx.t;
  run.stageT.placed = ctx.t;
  if (p.kind === 'food') {
    const r = run.restaurant!;
    const quote = ctx.s.pricing.quote(
      PriceRequest.parse({ cityId: CITY, vertical: 'food', stops: [{ zoneId: r.def.zoneId, type: 'pickup' }, { zoneId: p.dropoffZone, type: 'dropoff' }], at: new Date(ctx.t) }),
    );
    const serviceFee = quote.components.find((x) => x.key === 'service_fee')?.amount ?? 0;
    const delivery = quote.components.filter((x) => x.key !== 'service_fee').reduce((s, x) => s + x.amount, 0);
    const order = await ctx.call('customer.place', () =>
      ctx.s.orders.place(run.customerId, {
        cityId: CITY,
        type: 'food',
        merchantOrgId: r.orgId,
        // Item ids only: the app prices every line from the restaurant's catalog (review C2).
        lines: p.lines.map((l) => ({ catalogItemId: r.catalogIds.get(l.itemId) ?? l.itemId, qty: l.qty })),
        deliveryFeeIqd: delivery,
        serviceFeeIqd: serviceFee,
        paymentMethod: p.payment,
        dropoff: { zoneKey: p.dropoffZone, pin: p.dropoffPin },
      }),
    );
    if (!order) {
      run.placeError = 'refused';
      run.terminal = true;
      return;
    }
    run.orderId = order.id;
    run.state = order.state;
    return;
  }

  // Ride: locked quote → order → trip → smart broadcast (the customer app's request flow).
  const vertical = p.rideVertical ?? 'taxi';
  const pickupZone = zoneAt(c.home);
  const quote = ctx.s.pricing.quote(
    PriceRequest.parse({ cityId: CITY, vertical, stops: [{ zoneId: pickupZone, type: 'pickup' }, { zoneId: p.dropoffZone, type: 'dropoff' }], at: new Date(ctx.t) }),
  );
  const order = await ctx.call('customer.place', () =>
    ctx.s.orders.place(run.customerId, { cityId: CITY, type: 'ride', fareIqd: quote.total, quoteId: quote.id, paymentMethod: p.payment, dropoff: { zoneKey: p.dropoffZone, pin: p.dropoffPin } }),
  );
  if (!order) {
    run.placeError = 'refused';
    run.terminal = true;
    return;
  }
  run.orderId = order.id;
  run.state = order.state;
  const trip = await ctx.call('customer.ride_trip', () =>
    ctx.s.trips.createForOrders(
      {
        cityId: CITY,
        vertical,
        quoteId: quote.id,
        orders: [{ orderId: order.id }],
        stops: [
          { orderId: order.id, type: 'pickup', zoneKey: pickupZone, target: c.home },
          { orderId: order.id, type: 'dropoff', zoneKey: p.dropoffZone, target: p.dropoffPin },
        ],
      },
      run.customerId,
    ),
  );
  if (!trip) return;
  run.rideTripId = trip.id;
  run.stageT.searching = ctx.t;
  await ctx.call('customer.ride_request', () =>
    ctx.s.dispatch.request({
      tripId: trip.id,
      cityId: CITY,
      vertical,
      zoneId: pickupZone,
      pickup: c.home,
      dropoffZoneId: p.dropoffZone,
      cashIqd: p.payment === 'cash' ? order.totalIqd : 0,
    }),
  );
}

/** One customer step for a live order, given its current view. */
export async function customerStep(ctx: SimContext, run: OrderRun, order: Order): Promise<void> {
  const p = run.plan;
  if (['merchant_accepted', 'preparing', 'ready'].includes(order.state)) run.stageT.accepted ??= ctx.t;

  // Planned cancellation at its stage.
  if (p.cancel && !run.cancelTried) {
    const since = run.stageT[p.cancel.stage === 'before_merchant' ? 'placed' : p.cancel.stage === 'after_accept' ? 'accepted' : p.cancel.stage];
    if (since !== undefined && ctx.t >= since + p.cancel.afterSec * 1000) {
      run.cancelTried = true;
      await ctx.call('customer.cancel', () => ctx.s.orders.cancel(run.customerId, { orderId: run.orderId!, reason: `sim_${p.cancel!.stage}` }));
      return;
    }
  }

  // Partial accept: approve, decline, or let the 60 s run out.
  if (order.partial && order.state === 'placed' && !run.partialAnswered) {
    if (run.partialSeenT === null) {
      run.partialSeenT = ctx.t;
      const x = run.rand.next();
      run.partialAnswerAt = x < CUSTOMER_BEHAVIOUR.partialApprove + CUSTOMER_BEHAVIOUR.partialDecline ? ctx.t + run.rand.int(5, 40) * 1000 : null;
      run.decision = x < CUSTOMER_BEHAVIOUR.partialApprove ? 'accept' : 'reject';
    }
    if (run.partialAnswerAt !== null && ctx.t >= run.partialAnswerAt) {
      run.partialAnswered = true;
      await ctx.call('customer.partial', () => ctx.s.orders.respondPartial(run.customerId, { orderId: run.orderId!, approve: run.decision === 'accept' }));
    }
    return;
  }

  // A ride nobody has taken.
  if (order.type === 'ride' && order.state === 'placed' && run.rideTripId && !run.cancelTried) {
    const waited = (ctx.t - run.placedT) / 60_000;
    let cancel = waited >= CUSTOMER_BEHAVIOUR.ridePatienceMin;
    if (!cancel && !run.freeCancelSeen && waited >= 3) {
      const req = await ctx.s.dispatch.getRequest(run.rideTripId);
      if (req?.customerMayCancelFree) {
        run.freeCancelSeen = true;
        cancel = run.rand.chance(CUSTOMER_BEHAVIOUR.rideFreeCancel);
      }
    }
    if (cancel) {
      run.cancelTried = true;
      await ctx.call('customer.cancel_wait', () => ctx.s.orders.cancel(run.customerId, { orderId: run.orderId!, reason: 'no_driver' }));
    }
    return;
  }

  // Food that is ready and still has no courier long after.
  if (order.type === 'food' && ['merchant_accepted', 'preparing', 'ready'].includes(order.state) && !run.cancelTried && run.readyT !== null) {
    if (run.lastCourierId === null && ctx.t - run.readyT > CUSTOMER_BEHAVIOUR.foodPatienceAfterReadyMin * 60_000) {
      run.cancelTried = true;
      await ctx.call('customer.cancel_wait', () => ctx.s.orders.cancel(run.customerId, { orderId: run.orderId!, reason: 'no_courier' }));
    }
  }
}
