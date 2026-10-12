import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { DISPATCH_QUEUE_NAME, OfferOrchestrator, type TimerJob } from './modules/dispatch/offer.orchestrator.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { TIMER_STORE, TimerSweeper, type TimerStore } from './shared/timers/index.js';

/**
 * NTF-05 on the app's own wiring: dispatch hands its queue's handler to the global timer sweeper, so a
 * booked ride's or departure's far-ahead timer whose Redis job was lost still fires from the durable
 * table. A miswired `DispatchRuntime` (the sweeper injected as undefined) would boot fine and never fire them.
 */
describe('dispatch durable timers wiring (AppModule)', () => {
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

  it("the sweeper fires a due dispatch timer through the orchestrator's handler", async () => {
    const onTimer = vi.spyOn(app.get(OfferOrchestrator), 'onTimer').mockResolvedValue(undefined);
    const job: TimerJob = { kind: 'booked_open', tripId: 'trip-lost', epoch: 1, step: 0, durable: true };
    await app.get<TimerStore>(TIMER_STORE).schedule({ queue: DISPATCH_QUEUE_NAME, name: 'booked_open', jobId: 'dispatch.trip-lost.booked_open', data: job, dueAt: clock.now() });

    expect(await app.get(TimerSweeper).sweep()).toEqual({ fired: 1, retried: 0, failed: 0 });
    expect(onTimer).toHaveBeenCalledWith(job, 'sweeper');
  });
});
