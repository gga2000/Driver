import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { EventsService } from './modules/events/index.js';
import { OrdersService } from './modules/orders/index.js';
import { PricingService } from './modules/pricing/index.js';
import { PriceRequest } from '@driver/contracts';
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
    // The fare is the server's quote right now (night/peak fees apply after 22:00 Baghdad), never a constant.
    const fareIqd = app.get(PricingService).quote(PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'street_30', type: 'dropoff' }], options: { doorPickup: false, streetHandover: false }, at: new Date() })).total;
    // The driver is online first: placing the ride builds its trip and broadcasts it (dispatch:ride-request).
    const dispatch = app.get(DispatchService);
    await dispatch.presence.online('smoke-driver', { cityId: 'aziziyah', at: { lat: 32.9055, lng: 45.0605 }, vehicle: 'car', tier: 'bronze' });
    const order = await orders.place('smoke-rider', { cityId: 'aziziyah', type: 'ride', fareIqd, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'street_30' } });
    const trip = (await trips.activeForOrder(order.id))!;
    expect(trip.vertical).toBe('taxi');
    expect(trip.stops.map((s) => [s.type, s.zoneKey])).toEqual([
      ['pickup', 'centre'],
      ['dropoff', 'street_30'],
    ]);
    // The driver answers dispatch's offer (dispatch.respond is the only accept path).
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
