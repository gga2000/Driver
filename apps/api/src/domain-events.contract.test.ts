import { describe, expect, it } from 'vitest';
import { decodeDomainEvent, isDomainEventType } from '@driver/contracts';
import { DispatchSubscribers, FakeTripOffers } from './modules/dispatch/index.js';
import { dispatchHarness } from './modules/dispatch/test-harness.js';
import { LEDGER_SUBSCRIBED_EVENTS } from './modules/ledger/index.js';
import { ledgerHarness } from './modules/ledger/test-harness.js';
import { ordersHarness } from './modules/orders/test-harness.js';

/**
 * Contract tests (M2 wiring): what the producers (orders, trips) actually emit parses with the
 * schema each consumer (ledger, dispatch) decodes with, and the ledger settles it to the money
 * spec's numbers. Events travel as JSON through the outbox, so payloads are JSON round-tripped
 * and wrapped the way the ledger's bus wraps them (envelope keys merged under the payload).
 */
const wire = (x: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(x)) as Record<string, unknown>;

interface Emitted {
  type: string;
  actorId: string;
  occurredAt: Date;
  tripId?: string | undefined;
  orderId?: string | undefined;
  payload: Record<string, unknown>;
}

/** The ledger bus's envelope merge (`ledgerPayload`), on a recorded event. */
const asDelivered = (e: Emitted) => wire({ actorId: e.actorId, occurredAt: e.occurredAt, ...(e.tripId ? { tripId: e.tripId } : {}), ...(e.orderId ? { orderId: e.orderId } : {}), ...e.payload });

async function cashFoodOrderAndCancellations() {
  const h = ordersHarness();
  // a delivered, cash-collected, closed order
  const o = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'nakra' } }));
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  const t = await h.tripFor(o.id);
  await h.pickup(t.id);
  await h.dropoff(t.id, { cashCollectedIqd: 16500 });
  await h.advance(2 * 60 * 60_000);
  // a paid cancellation (preparing, courier en route) and a free one
  const c = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m1', { orderId: c.id, prepMinutes: 15 });
  await h.tripFor(c.id, { driverId: 'd2' });
  await h.orders.markPreparing('m1', { orderId: c.id });
  await h.orders.cancel('c1', { orderId: c.id });
  const f = await h.orders.place('c1', h.foodInput());
  await h.orders.cancel('c1', { orderId: f.id });
  // a cash ride, completed by the driver at the door, then closed
  const r = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', fareIqd: 3000, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'street_30' } });
  const rt = await h.tripFor(r.id, { vertical: 'taxi', vehicleClass: 'car', driverId: 'd3' });
  await h.pickup(rt.id, 'd3');
  await h.dropoff(rt.id, { driverId: 'd3', cashCollectedIqd: 3000 });
  await h.advance(2 * 60 * 60_000);
  const emitted: Emitted[] = [...h.events.events, ...h.tripEvents.events];
  return { h, emitted, ids: { delivered: o.id, cancelled: c.id, free: f.id, ride: r.id } };
}

describe('domain event contracts: producers ↔ consumers', () => {
  it('every cross-module event orders and trips emit decodes with its shared schema', async () => {
    const { emitted } = await cashFoodOrderAndCancellations();
    const contracted = emitted.filter((e) => isDomainEventType(e.type));
    expect(new Set(contracted.map((e) => e.type))).toEqual(
      new Set(['order.accepted', 'order.cash_collected', 'merchant.payable_accrued', 'order.closed', 'order.cancelled', 'trip.accepted', 'trip.completed', 'trip.cancelled', 'stop.completed']),
    );
    for (const e of contracted) {
      if (!isDomainEventType(e.type)) continue;
      expect(() => decodeDomainEvent(e.type as never, asDelivered(e)), `${e.type} ${JSON.stringify(e.payload)}`).not.toThrow();
    }
  });

  it('the ledger settles exactly what orders emitted: worked example, cancellation splits, ride take; replays add nothing', async () => {
    const { emitted, ids } = await cashFoodOrderAndCancellations();
    const l = ledgerHarness();
    const forLedger = emitted.filter((e) => LEDGER_SUBSCRIBED_EVENTS.includes(e.type));
    expect(forLedger.map((e) => e.type)).toEqual(expect.arrayContaining(['order.cash_collected', 'order.closed', 'order.cancelled']));
    for (const e of forLedger) await l.bus.publish(e.type, asDelivered(e));

    // food, worked example: platform 2,750 (+ the ride's 360 take), courier 1,000, merchant 12,750 (+ 15,000 cancellation)
    expect((await l.ledger.balance('driver:d1')).amount).toBe(1000);
    expect((await l.ledger.balance('cash:d1')).amount).toBe(-16500);
    expect((await l.ledger.balance('merchant_cash:rest_1')).amount).toBe(12750 + 15000);
    // cancellation while preparing: 15,000 food to the merchant, 500 to the courier en route, owed by the customer
    expect((await l.ledger.balance('driver:d2')).amount).toBe(500);
    // ride, cash: car take 12 % of 3,000
    expect((await l.ledger.balance('driver:d3')).amount).toBe(3000 - 360);
    expect((await l.ledger.balance('platform')).amount).toBe(2750 + 360);
    expect((await l.ledger.eventsFor('customer:c1')).filter((e) => e.type === 'cancellation_fee').map((e) => e.amount).sort((a, b) => a - b)).toEqual([500, 15000]);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
    expect(ids.free).toBeTruthy(); // the free cancel posted nothing (no third cancellation_fee line above)

    const before = (await l.repo.all()).length;
    for (const e of forLedger) await l.bus.publish(e.type, asDelivered(e));
    expect((await l.repo.all()).length).toBe(before);
  });

  it('dispatch consumes order.accepted and the trip events orders/trips emit', async () => {
    const { emitted } = await cashFoodOrderAndCancellations();
    const d = dispatchHarness();
    const trips = new FakeTripOffers();
    const subscribers = new DispatchSubscribers(d.orchestrator, trips, d.zones);
    for (const e of emitted.filter((x) => x.type === 'order.accepted')) {
      await subscribers.onOrderAccepted({ type: e.type, orderId: e.orderId, aggregateId: e.orderId!, payload: wire(e.payload) });
    }
    expect(trips.created.map((c) => [c.vertical, c.pickup.zoneKey, c.dropoff.zoneKey])).toEqual([
      ['food', 'centre', 'nakra'],
      ['food', 'centre', 'zakur'],
    ]);
    expect(await d.service.getRequest(`trip-${trips.created[0]!.orderId}`)).toMatchObject({ policy: 'auto_assign', cashIqd: 16500, minVehicleClass: 'bike' });
    for (const e of emitted.filter((x) => x.type.startsWith('trip.') || x.type === 'stop.completed')) {
      await subscribers.onTripEvent({ type: e.type, tripId: e.tripId, aggregateId: e.tripId!, actorId: e.actorId, payload: wire(e.payload) });
    }
  });
});
