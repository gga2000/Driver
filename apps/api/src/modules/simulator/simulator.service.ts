import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { SimulatorStartInput, SimulatorStatus } from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, FakeClock, type Clock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { DISPATCH_QUEUE, DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { CapsService, LedgerService, MerchantCashService, ShiftGuaranteeService } from '../ledger/index.js';
import { ORDERS_QUEUE, OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { CatalogService } from '../catalog/index.js';
import { PricingService } from '../pricing/index.js';
import { TRIPS_QUEUE, TripsService } from '../trips/index.js';
import type { DeskOverride } from './actors/dispatcher.js';
import type { DrainableQueue, SimServices } from './context.js';
import { Simulation, type Progress } from './engine.js';
import { injectFault } from './faults.js';
import type { SimSnapshot } from './invariants.js';
import { buildReport, type SimulationReport } from './report.js';
import { DAY_MINUTES, DEFAULT_DAY_START, buildScenario } from './scenario.js';
import { buildWorld, supplyMix } from './world.js';

export interface RunOptions {
  orders: number;
  drivers?: number;
  restaurants?: number;
  customers?: number;
  seed: number;
  tickSec?: number;
  /** Deliberate rule breaks applied to the snapshot before the checks (tests, `--inject-fault`). */
  faults?: string[];
  onProgress?: (p: Progress) => void;
}

export interface RunResult {
  report: SimulationReport;
  snapshot: SimSnapshot;
}

/** Live mode: simulated seconds per real second unless the Console asks otherwise. */
export const DEFAULT_LIVE_SPEED = 60;
const LIVE_TICK_MS = 1000;

/** Live start options: the Console contract, plus a tick interval tests may shorten (not exposed over tRPC). */
export type LiveStartInput = z.infer<typeof SimulatorStartInput> & { speed?: number | undefined; tickMs?: number | undefined };

interface LiveRun {
  sim: Simulation;
  input: LiveStartInput;
  speed: number;
  tickMs: number;
  startedAt: Date;
  timer: NodeJS.Timeout;
  busy: boolean;
  lastReal: number;
  wallStart: number;
}

/**
 * The Aziziyah simulator (plan Step 7).
 *
 * `run` — in-process: the app booted on a `FakeClock` with in-memory repositories and queues; the
 * clock advances in ticks, the app's timer queues drain on it, every actor acts through the real
 * services, and the end-of-run snapshot is checked against the named invariants (`pnpm sim`).
 *
 * `start` / `status` / `stop` — live: the same actors against the running API on its own clock at
 * `speed`× (drivers really online, heartbeating and moving, so the Console map shows them gliding);
 * stopping computes the report on what happened so far.
 */
@Injectable()
export class SimulatorService implements OnModuleDestroy {
  private readonly logger = new Logger(SimulatorService.name);
  private live: LiveRun | null = null;
  private lastReport: SimulationReport | null = null;

  constructor(
    private readonly identity: IdentityService,
    private readonly orgs: OrgsService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly trips: TripsService,
    private readonly dispatch: DispatchService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    private readonly merchantCash: MerchantCashService,
    private readonly guarantee: ShiftGuaranteeService,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly moduleRef: ModuleRef,
  ) {}

  services(): SimServices {
    return {
      identity: this.identity,
      orgs: this.orgs,
      catalog: this.catalog,
      orders: this.orders,
      trips: this.trips,
      dispatch: this.dispatch,
      pricing: this.pricing,
      ledger: this.ledger,
      caps: this.caps,
      merchantCash: this.merchantCash,
      guarantee: this.guarantee,
      events: this.events,
    };
  }

  /** The app's timer queues, which an in-process run drains on its fake clock. */
  private timerQueues(): DrainableQueue[] {
    const out: DrainableQueue[] = [];
    for (const token of [ORDERS_QUEUE, TRIPS_QUEUE, DISPATCH_QUEUE]) {
      const q = this.moduleRef.get<unknown>(token, { strict: false });
      if (!(q instanceof InMemoryQueue)) throw new Error('the in-process simulator needs the in-memory app: run it without REDIS_URL');
      out.push(q);
    }
    return out;
  }

  // ───────────────────────── in-process ─────────────────────────

  async run(opts: RunOptions): Promise<RunResult> {
    const clock = this.clock;
    if (!(clock instanceof FakeClock)) throw new Error('the in-process simulator needs the app booted on a FakeClock');
    const wallStart = Date.now();
    const world = buildWorld({ seed: opts.seed, drivers: opts.drivers ?? 60, restaurants: opts.restaurants ?? 10, customers: opts.customers ?? Math.max(100, Math.ceil(opts.orders / 4)), dayMinutes: DAY_MINUTES });
    const plan = buildScenario(world, { orders: opts.orders });
    clock.set(DEFAULT_DAY_START);
    const sim = new Simulation(this.services(), {
      world,
      plan,
      dayStart: new Date(DEFAULT_DAY_START),
      queues: this.timerQueues(),
      advanceClock: (ms) => clock.advance(ms),
      appNow: () => clock.now(),
    });
    try {
      await sim.setup();
      await sim.runDay({ tickSec: opts.tickSec ?? 5, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}) });
      const snapshot = await sim.snapshot();
      for (const f of opts.faults ?? []) injectFault(snapshot, f);
      const report = buildReport(
        snapshot,
        {
          seed: opts.seed,
          orders: opts.orders,
          drivers: world.drivers.length,
          restaurants: world.restaurants.length,
          customers: world.customers.length,
          tickSec: opts.tickSec ?? 5,
          speed: 1,
          mode: 'in_process',
          startedAt: new Date(DEFAULT_DAY_START),
          endedAt: clock.now(),
          wallMs: Date.now() - wallStart,
          supply: supplyMix(world.drivers.length),
          refusals: Object.fromEntries([...sim.refusals.entries()].sort(([a], [b]) => a.localeCompare(b))),
          placeRefused: [...sim.orders.values()].filter((r) => r.placeError).length,
        },
        plan.length,
      );
      this.lastReport = report;
      return { report, snapshot };
    } finally {
      sim.dispose();
    }
  }

  // ───────────────────────── live (Console) ─────────────────────────

  async start(input: LiveStartInput): Promise<z.input<typeof SimulatorStatus>> {
    if (this.live) return this.status();
    const speed = input.speed ?? DEFAULT_LIVE_SPEED;
    const seed = input.seed ?? 1;
    const world = buildWorld({ seed, drivers: input.drivers, restaurants: 10, customers: 200, dayMinutes: DAY_MINUTES });
    const plan = buildScenario(world, { orders: Math.max(1, Math.round((input.ordersPerHour * DAY_MINUTES) / 60)) });
    const now = this.clock.now();
    const sim = new Simulation(this.services(), { world, plan, dayStart: now, speed, appNow: () => this.clock.now() });
    await sim.setup();
    const tickMs = input.tickMs ?? LIVE_TICK_MS;
    const run: LiveRun = { sim, input, speed, tickMs, startedAt: now, busy: false, lastReal: Date.now(), wallStart: Date.now(), timer: undefined as unknown as NodeJS.Timeout };
    run.timer = setInterval(() => void this.liveTick(run), tickMs);
    run.timer.unref();
    this.live = run;
    this.logger.log(`simulator started: ${world.drivers.length} drivers, ${plan.length} orders over a ${DAY_MINUTES / 60}-hour day at ${speed}×`);
    return this.status();
  }

  /** One live step: real time since the last step × speed, never two at once. */
  async liveTick(run: LiveRun): Promise<void> {
    if (run.busy || this.live !== run) return;
    run.busy = true;
    try {
      const now = Date.now();
      const dtSec = ((now - run.lastReal) / 1000) * run.speed;
      run.lastReal = now;
      await run.sim.tick(dtSec);
      const p = run.sim.progress();
      if (p.simTime.getTime() >= run.sim.dayEnd && p.live === 0) await this.stop();
    } catch (err) {
      this.logger.error(`simulator tick failed: ${(err as Error).message}`);
    } finally {
      run.busy = false;
    }
  }

  async stop(): Promise<z.input<typeof SimulatorStatus>> {
    const run = this.live;
    if (!run) return this.status();
    clearInterval(run.timer);
    this.live = null;
    try {
      for (const d of run.sim.drivers) if (d.online) await run.sim.call('driver.offline', () => this.dispatch.presence.offline(d.personId));
      const snapshot = await run.sim.snapshot();
      this.lastReport = buildReport(
        snapshot,
        {
          seed: run.input.seed ?? 1,
          orders: run.sim.progress().planned,
          drivers: run.sim.drivers.length,
          restaurants: run.sim.restaurants.length,
          customers: run.sim.world.customers.length,
          tickSec: (run.tickMs / 1000) * run.speed,
          speed: run.speed,
          mode: 'live',
          startedAt: run.startedAt,
          endedAt: this.clock.now(),
          wallMs: Date.now() - run.wallStart,
          supply: supplyMix(run.sim.drivers.length),
          refusals: Object.fromEntries(run.sim.refusals),
          placeRefused: [...run.sim.orders.values()].filter((r) => r.placeError).length,
        },
        run.sim.progress().planned,
      );
    } finally {
      run.sim.dispose();
    }
    return this.status();
  }

  status(): z.input<typeof SimulatorStatus> {
    const run = this.live;
    const r = this.lastReport;
    return {
      available: true,
      running: run !== null,
      startedAt: run?.startedAt ?? null,
      drivers: run?.sim.drivers.length ?? 0,
      ordersPerHour: run?.input.ordersPerHour ?? 0,
      ...(run ? { speed: run.speed, progress: run.sim.progress() } : {}),
      ...(r
        ? {
            lastReport: {
              ok: r.ok,
              mode: r.run.mode,
              endedAt: r.run.endedAt,
              orders: r.orders.placed,
              delivered: r.orders.delivered,
              deliveredShare: r.orders.deliveredShare,
              invariants: r.invariants.length,
              violations: r.violations.map((v) => ({ invariant: v.invariant, count: v.count })),
            },
          }
        : {}),
    };
  }

  /** The manual offers the simulated ops desk has sent in the current live run (empty when stopped). */
  liveDeskOverrides(): readonly DeskOverride[] {
    return this.live?.sim.dispatcher.overrides ?? [];
  }

  /** The full report of the last run (in-process or live). */
  report(): SimulationReport | null {
    return this.lastReport;
  }

  onModuleDestroy(): void {
    if (this.live) {
      clearInterval(this.live.timer);
      this.live.sim.dispose();
      this.live = null;
    }
  }
}
