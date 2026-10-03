import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { EventsService } from './modules/events/index.js';
import { OrdersService } from './modules/orders/index.js';
import { TripsService } from './modules/trips/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCH_REPOSITORY, type DispatchRepository } from './modules/dispatch/dispatch.repository.js';

/** The events module as the app wires it (no DATABASE_URL / REDIS_URL: in-memory, sync drain). */
describe('events wiring smoke', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the named subscribers of orders, ledger and the contradiction detector', () => {
    const names = app.get(EventsService).registry.names();
    expect(names).toContain('orders:trip-events');
    expect(names).toContain('ledger:order.closed');
    expect(names).toContain('ledger:order.cash_collected');
    expect(names).toContain('ledger:order.cancelled');
    expect(names).toContain('dispatch:auto-assign');
    expect(names).toContain('dispatch:trip-events');
    expect(names).toContain('events:contradiction-detector');
  });

  it('trip events flow through the outbox to orders, and late replays are quarantined via the trips lookup', async () => {
    const events = app.get(EventsService);
    const trips = app.get(TripsService);
    const orders = app.get(OrdersService);
    const order = await orders.place('smoke-rider', { cityId: 'aziziyah', type: 'ride', fareIqd: 3000, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'street_30' } });
    const trip = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'taxi',
      orders: [{ orderId: order.id }],
      stops: [
        { orderId: order.id, type: 'pickup', zoneKey: 'centre' },
        { orderId: order.id, type: 'dropoff', zoneKey: 'zakur' },
      ],
    });
    // The driver answers dispatch's offer (dispatch.respond is the only accept path).
    const dispatch = app.get(DispatchService);
    await dispatch.presence.online('smoke-driver', { cityId: 'aziziyah', at: { lat: 32.9055, lng: 45.0605 }, vehicle: 'car', tier: 'bronze' });
    await dispatch.request({ tripId: trip.id, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre' });
    const offer = (await app.get<DispatchRepository>(DISPATCH_REPOSITORY, { strict: false }).listByTrip(trip.id)).find((o) => o.driverId === 'smoke-driver')!;
    await dispatch.respond({ personId: 'smoke-driver', sessionId: 's' }, { offerId: offer.id, accept: true });
    // delivered to orders through the outbox before respond() returned: the ride is matched
    expect((await orders.get(order.id)).state).toBe('matched');
    expect((await events.forTrip(trip.id)).map((e) => e.type)).toContain('trip.accepted');

    await trips.detachOrder(trip.id, order.id, 'system', 'reassigned');
    const replay = await events.emit(
      undefined,
      { type: 'stop.completed', actorId: 'smoke-driver', occurredAt: new Date(Date.now() - 60_000), tripId: trip.id, orderId: order.id, deviceUptimeMs: 99_000, payload: { stopType: 'dropoff' } },
      { name: 'trip', id: trip.id },
    );
    expect(replay).toMatchObject({ quarantined: true, quarantineReason: 'late_replay' });
    expect((await orders.get(order.id)).state).not.toBe('delivered');
    expect(await events.pendingOutbox()).toBe(0);
  });
});
