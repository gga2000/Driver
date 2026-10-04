import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SimulatorStatus } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CLOCK, type Clock } from './shared/clock.js';
import { ConsoleReadService } from './modules/console/index.js';
import { SimulatorService } from './modules/simulator/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Live mode (plan Step 7): the Console's `system.simulator.start` runs the actors against the
 * running API on its own clock at `speed`×; drivers are really online and moving, so the map
 * (`console.driverPositions`) shows them; `stop` halts and leaves the report summary in `status`.
 */
describe('simulator live mode against the running app', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    // The live run starts at the app clock's "now": pin it to a lunchtime start running at real speed,
    // so the test does not depend on the hour it runs at (a 04:00 start sees almost no demand).
    const t0 = Date.now();
    const start = new Date('2026-10-04T09:00:00Z').getTime();
    const lunchClock: Clock = { now: () => new Date(start + (Date.now() - t0)) };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(lunchClock).compile();
    moduleRef.useLogger(['error']);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('start → drivers online and gliding on the map → status shows progress → stop leaves the report', async () => {
    const sim = app.get(SimulatorService);
    const reads = app.get(ConsoleReadService);
    expect(await reads.simulatorStatus()).toMatchObject({ available: true, running: false });

    const started = SimulatorStatus.parse(await reads.simulatorStart({ cityId: 'aziziyah', drivers: 8, ordersPerHour: 60, seed: 5, speed: 900 }));
    expect(started).toMatchObject({ available: true, running: true, drivers: 8, ordersPerHour: 60, speed: 900 });
    // A second start while running is a no-op that reports the run.
    expect(await sim.start({ cityId: 'aziziyah', drivers: 3, ordersPerHour: 10 })).toMatchObject({ running: true, drivers: 8 });

    await sleep(3500);
    const first = await reads.driverPositions('aziziyah');
    expect(first.drivers.length).toBeGreaterThan(0);
    const status = SimulatorStatus.parse(await reads.simulatorStatus());
    expect(status.running).toBe(true);
    expect(status.progress!.driversOnline).toBeGreaterThan(0);
    expect(status.progress!.placed).toBeGreaterThan(0);
    expect(status.progress!.simTime.getTime() - started.startedAt!.getTime()).toBeGreaterThan(30 * 60_000); // ~900× real time

    // Someone moves between two looks at the map.
    let moved = false;
    for (let i = 0; i < 6 && !moved; i += 1) {
      await sleep(1000);
      const next = await reads.driverPositions('aziziyah');
      moved = next.drivers.some((d) => {
        const before = first.drivers.find((x) => x.driverId === d.driverId);
        return before !== undefined && (before.lat !== d.lat || before.lng !== d.lng);
      });
    }
    expect(moved).toBe(true);

    const stopped = SimulatorStatus.parse(await reads.simulatorStop());
    expect(stopped.running).toBe(false);
    expect(stopped.lastReport).toMatchObject({ mode: 'live', invariants: expect.any(Number) });
    expect(stopped.lastReport!.orders).toBeGreaterThan(0);
    // Its drivers went offline with it.
    expect((await reads.driverPositions('aziziyah')).drivers).toEqual([]);
  }, 30_000);
});
