import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LatLng } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { ETA_LEARNING_SUBSCRIBER, LearnedEtaCorrection } from './modules/eta/index.js';
import { SubscriberRegistry } from './modules/events/index.js';
import { OrdersService } from './modules/orders/index.js';
import { EtaService } from './modules/routing/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';

const KITCHEN: LatLng = { lat: 32.905, lng: 45.06 };
const DOOR: LatLng = { lat: 32.9185, lng: 45.0712 };

/**
 * Maps program f7 on the app's own wiring: the global `eta` module binds the learned correction into
 * routing's `EtaService` (an optional port, so a miswired app would silently quote uncorrected) and
 * subscribes its learner to the outbox; orders gets that same `EtaService`, so placement locks the
 * honest-delay promise's ride from the learned minutes (Ali, 2026-10-07; also an optional port).
 */
describe('learned ETA wiring (AppModule)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(new FakeClock('2026-10-06T09:00:00Z')).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('EtaService asks the learned correction, and the learner listens to stop arrivals', async () => {
    const factor = vi.spyOn(app.get(LearnedEtaCorrection), 'factor');
    const quote = await app.get(EtaService).minutes(KITCHEN, DOOR, 'bike');
    expect(factor).toHaveBeenCalledWith({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' });
    // Nothing learned yet: the router's own minutes.
    expect(quote).toEqual(await app.get(EtaService).baseMinutes(KITCHEN, DOOR, 'bike').then(({ minutes, basis }) => ({ minutes, basis })));
    expect(app.get(SubscriberRegistry).names()).toContain(ETA_LEARNING_SUBSCRIBER);
  });

  it('orders locks the promise from the same learned EtaService', () => {
    expect(app.get(OrdersService)['eta']).toBe(app.get(EtaService));
  });
});
