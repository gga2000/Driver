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

/** Sim seconds per tick-second for this run (with fixed steps, the real pace on a fast machine). */
const SPEED = 30;

/**
 * The app's clock driven by the simulation's own time. Live mode normally runs the app on the wall
 * clock, so a few sim-minutes pass before any 15-s offer timer fires and nothing ever goes red; here
 * the app's timers (offer waves, red cards) and the simulated people (the desk's 20–60 s reaction)
 * read one time source, so a slow machine (CI) slows both together instead of letting the app's
 * timers run ahead of the desk and resolve its cards before it can react. Before the run starts and
 * after it stops the clock holds the last time it saw.
 */
class SimDrivenClock implements Clock {
  private last = new Date('2026-10-04T07:00:00Z').getTime();
  source: (() => Date | null) | null = null;
  now(): Date {
    const t = this.source?.();
    if (t) this.last = t.getTime();
    return new Date(this.last);
  }
}

/**
 * Live mode has the same ops desk as the in-process run (plan Step 7): cards that need the
 * dispatcher are picked up after a 20–60 s reaction (sim time) and offered by hand
 * (`dispatch.override`) to a free driver who fits, so the "يحتاج موزّع" queue stays short.
 */
describe('simulator live mode: the ops desk works the red cards', () => {
  let app: INestApplicationContext;
  const clock = new SimDrivenClock();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    moduleRef.useLogger(['error']);
    app = await moduleRef.init();
    const sim = app.get(SimulatorService);
    clock.source = () => sim.liveNow();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a live run of a few sim-minutes ends with a small needs-dispatcher queue', async () => {
    const sim = app.get(SimulatorService);
    const dispatch = app.get(DispatchService);
    const trips = app.get(TripsService);

    // Lock-step: 200-ms ticks of a fixed 6 sim-s each (close to the in-process run's 5 s), and the app's
    // timers fire at the sim's time, so a seed plays out the same on any machine (a slow runner only
    // stretches it in real time). The day opens with a third of the fleet still off shift, so some
    // cards find nobody and turn red: the desk's work. A red card also gets a background retry after
    // 60 s that can beat the desk's 20–60 s reaction (checked every 15 s); seed 10 is a day where the
    // desk wins some of those races (seed 7, used before lock-step, is one where the retry wins all).
    const t0 = clock.now().getTime();
    await sim.start({ cityId: 'aziziyah', drivers: 60, ordersPerHour: 150, seed: 10, speed: SPEED, tickMs: 200, fixedStep: true });
    const simMs = () => clock.now().getTime() - t0;
    const redCounts: number[] = [];
    // A hand-offered job counts once the chosen driver holds it, watched while the run goes on.
    const takenByChosen = async () =>
      (await Promise.all(sim.liveDeskOverrides().map(async (o) => (await trips.get(o.tripId)).courierId === o.driverId))).some(Boolean);
    let taken = false;
    // The red queue is sampled every sim-minute for the first 12 sim-minutes. Red cards are few in
    // this small town (a handful in half an hour), so the desk gets up to 45 sim-minutes to have one
    // taken; the budget is sim time, so CPU load cannot cut it short. The wall cap only stops a hung
    // run before the test's own timeout.
    const SAMPLES = 12;
    const SIM_BUDGET_MS = 45 * 60_000;
    const wallCap = Date.now() + 160_000;
    while (redCounts.length < SAMPLES || (!taken && simMs() < SIM_BUDGET_MS)) {
      if (Date.now() > wallCap) break;
      await sleep(100);
      if (redCounts.length < SAMPLES && simMs() >= (redCounts.length + 1) * 60_000) {
        const board = await dispatch.board('aziziyah');
        redCounts.push(board.cards.filter((c) => c.status === 'needs_dispatcher').length);
      }
      if (!taken) taken = await takenByChosen();
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
    expect(taken).toBe(true);
    // The red queue stays small throughout and at the end (without the desk it only grows).
    expect(Math.max(...redCounts)).toBeLessThanOrEqual(5);
    expect(redCounts.at(-1)!).toBeLessThanOrEqual(3);
  }, 180_000);
});
