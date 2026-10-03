import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCHER_BEHAVIOUR, SimulatorService } from './modules/simulator/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, type Clock } from './shared/clock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sim seconds per real second for this run. */
const SPEED = 30;

/**
 * The app's clock running `k`× real time. Live mode normally runs the app on the wall clock, so a
 * few sim-minutes at 60× pass before any 15-s offer timer fires and nothing ever goes red; here the
 * app's timers keep pace with the simulation, so cards really pass through the waves, turn red and
 * reach the desk within seconds of test time.
 */
class ScaledClock implements Clock {
  private readonly t0 = Date.now();
  private readonly start = new Date('2026-10-04T07:00:00Z').getTime();
  constructor(private readonly k: number) {}
  now(): Date {
    return new Date(this.start + (Date.now() - this.t0) * this.k);
  }
}

/**
 * Live mode has the same ops desk as the in-process run (plan Step 7): cards that need the
 * dispatcher are picked up after a 20–60 s reaction (sim time) and offered by hand
 * (`dispatch.override`) to a free driver who fits, so the "يحتاج موزّع" queue stays short.
 */
describe('simulator live mode: the ops desk works the red cards', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(new ScaledClock(SPEED)).compile();
    moduleRef.useLogger(['error']);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a live run of a few sim-minutes ends with a small needs-dispatcher queue', async () => {
    const sim = app.get(SimulatorService);
    const dispatch = app.get(DispatchService);
    const trips = app.get(TripsService);

    // 200-ms ticks: 6 sim-s per step, close to the in-process run's 5 s. The day opens with a third
    // of the fleet still off shift, so some cards find nobody and turn red: the desk's work.
    await sim.start({ cityId: 'aziziyah', drivers: 60, ordersPerHour: 150, seed: 7, speed: SPEED, tickMs: 200 });
    const redCounts: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      await sleep(2000);
      const board = await dispatch.board('aziziyah');
      redCounts.push(board.cards.filter((c) => c.status === 'needs_dispatcher').length);
    }
    const overrides = [...sim.liveDeskOverrides()];
    const progress = sim.status().progress!;
    await sim.stop();

    // ~12 sim-minutes, orders placed, the desk did work.
    expect(progress.placed).toBeGreaterThan(5);
    expect(overrides.length).toBeGreaterThan(0);
    // Never faster than a human: at least 20 s (sim) from seeing a card red to the manual offer.
    const [minReaction] = DISPATCHER_BEHAVIOUR.reactionSec;
    for (const o of overrides) expect(o.at - o.redSinceT).toBeGreaterThanOrEqual(minReaction * 1000);
    // At least one hand-offered job was taken by the driver the desk chose.
    const taken = await Promise.all(overrides.map(async (o) => (await trips.get(o.tripId)).courierId === o.driverId));
    expect(taken.some(Boolean)).toBe(true);
    // The red queue stays small throughout and at the end (without the desk it only grows).
    expect(Math.max(...redCounts)).toBeLessThanOrEqual(5);
    expect(redCounts.at(-1)!).toBeLessThanOrEqual(3);
  }, 60_000);
});
