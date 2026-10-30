import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { KhatService } from './modules/khat/index.js';
import { ORDER_JOBS, OrdersService } from './modules/orders/index.js';
import { TRIP_JOBS, TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { TIMER_STORE, TimerSweeper, type TimerStore } from './shared/timers/index.js';

/**
 * FLW-22 on the app's own wiring: the orders, trips and خطوط modules hand their queues' handlers to the
 * global timer sweeper, so a timer whose Redis job was lost still fires from the durable table. A module
 * that got the sweeper injected as undefined would boot fine and never fire them.
 */
describe('order, trip and خطوط durable timers wiring (AppModule)', () => {
  let app: INestApplication;
  let clock: FakeClock;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    clock = new FakeClock('2026-10-06T09:00:00Z');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('the sweeper fires each module’s due timer through that module’s handler', async () => {
    const orders = vi.spyOn(app.get(OrdersService), 'handleTimer').mockResolvedValue(undefined);
    const trips = vi.spyOn(app.get(TripsService), 'handleTimer').mockResolvedValue(undefined);
    const khat = vi.spyOn(app.get(KhatService), 'checkSweep').mockResolvedValue('not_applicable');
    const store = app.get<TimerStore>(TIMER_STORE);
    const dueAt = clock.now();
    await store.schedule({ queue: 'orders.timers', name: ORDER_JOBS.autoReject, jobId: 'order.lost.autoReject.1', data: { orderId: 'lost', refMs: 1 }, dueAt });
    await store.schedule({ queue: 'trips.timers', name: TRIP_JOBS.rideAutoComplete, jobId: 'trip.lost.autocomplete.1', data: { tripId: 'lost', positionAtMs: 1 }, dueAt });
    await store.schedule({ queue: 'khat.timers', name: 'khat.sweepCheck', jobId: 'khat.sweep.lost.1', data: { tripId: 'lost' }, dueAt });

    expect(await app.get(TimerSweeper).sweep()).toEqual({ fired: 3, retried: 0, failed: 0 });
    expect(orders).toHaveBeenCalledWith(ORDER_JOBS.autoReject, { orderId: 'lost', refMs: 1 });
    expect(trips).toHaveBeenCalledWith(TRIP_JOBS.rideAutoComplete, { tripId: 'lost', positionAtMs: 1 });
    expect(khat).toHaveBeenCalledWith('lost');
  });
});
