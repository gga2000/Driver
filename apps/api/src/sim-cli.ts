import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConsoleLogger, type INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { DEFAULT_DAY_START, INVARIANTS, SimulatorService, summaryTable, type RunOptions, type SimulationReport } from './modules/simulator/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { PRISMA_LOG_CONTEXT } from './shared/db/prisma-error-log.js';

/**
 * `pnpm sim --orders 2000 --drivers 60 --restaurants 10 --seed 1 [--ci] [--report path]`
 *
 * Boots the real API (`AppModule`) in memory on a fake clock, runs a simulated Aziziyah day through
 * it, prints an Arabic + English summary and exits 1 on any invariant violation. `--ci` (or
 * `--report`) writes `simulation-report.json`. `--inject-fault <invariant>` deliberately breaks one
 * rule to show the gate failing by name.
 */

export interface CliArgs {
  orders: number;
  drivers: number;
  restaurants: number;
  customers: number | undefined;
  seed: number;
  tickSec: number;
  /** Live (Console) runs only: an in-process run is as fast as the machine. */
  speed: number | undefined;
  ci: boolean;
  report: string | undefined;
  faults: string[];
  quiet: boolean;
  /** `postgres`: the real Prisma repositories on DATABASE_URL (sim.ts keeps it); `memory` by default. */
  db: 'memory' | 'postgres';
}

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  writeFile(path: string, content: string): Promise<void>;
}

const defaultIo: CliIo = {
  log: (l) => console.log(l),
  error: (l) => console.error(l),
  writeFile: (p, c) => writeFile(p, c, 'utf8'),
};

export function parseArgs(argv: readonly string[]): CliArgs {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a number (got ${raw})`);
    return n;
  };
  const faults: string[] = [];
  argv.forEach((a, i) => {
    if (a === '--inject-fault' && argv[i + 1]) faults.push(argv[i + 1]!);
  });
  for (const f of faults) if (!INVARIANTS.some((x) => x.name === f)) throw new Error(`--inject-fault: unknown invariant ${f}`);
  const customers = value('customers');
  const db = value('db') ?? 'memory';
  if (db !== 'memory' && db !== 'postgres') throw new Error(`--db must be memory or postgres (got ${db})`);
  return {
    orders: num('orders', 2000),
    drivers: num('drivers', 60),
    restaurants: num('restaurants', 10),
    customers: customers === undefined ? undefined : num('customers', 0),
    seed: num('seed', 1),
    tickSec: num('tick', 5),
    speed: value('speed') === undefined ? undefined : num('speed', 60),
    ci: argv.includes('--ci'),
    report: value('report'),
    faults,
    quiet: argv.includes('--quiet'),
    db,
  };
}

/** Module pollers (`setInterval`) would drain the queues on real time; the simulator drives them on its clock. */
async function withoutIntervals<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.setInterval;
  globalThis.setInterval = ((..._args: unknown[]) => ({ unref() {}, ref() {}, hasRef: () => false, refresh() {}, [Symbol.toPrimitive]: () => 0 })) as unknown as typeof setInterval;
  try {
    return await fn();
  } finally {
    globalThis.setInterval = real;
  }
}

/** Prints errors and warnings as before, and keeps every failed Prisma query (`prisma-error-log.ts`). */
class SimLogger extends ConsoleLogger {
  readonly prismaFailures: string[] = [];

  constructor() {
    super();
    this.setLogLevels(['error', 'warn']);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    if (rest.at(-1) === PRISMA_LOG_CONTEXT) this.prismaFailures.push(String(message));
    super.warn(message, ...(rest as [string]));
  }
}

/**
 * The API on a fake clock with its pollers off: in-memory repositories and queues, or (with
 * DATABASE_URL set, `--db postgres`) the Prisma repositories with in-memory queues.
 */
export async function bootSimApp(): Promise<{ app: INestApplicationContext; clock: FakeClock; prismaFailures: readonly string[] }> {
  const clock = new FakeClock(DEFAULT_DAY_START);
  const logger = new SimLogger();
  const app = await withoutIntervals(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    moduleRef.useLogger(logger);
    return moduleRef.init();
  });
  return { app, clock, prismaFailures: logger.prismaFailures };
}

/**
 * `--db postgres` only: what the in-memory run cannot see. A failed Prisma query (a foreign key, an
 * aborted transaction: the bug class the real-database sweep found, CRIT3-05) or an outbox delivery
 * that needed a retry since `since` fails the run even when every invariant holds.
 */
async function postgresChecks(app: INestApplicationContext, prismaFailures: readonly string[], since: Date): Promise<{ lines: string[]; bad: string[] }> {
  const prisma = app.get(PrismaService);
  if (!prisma.configured) return { lines: [], bad: ['--db postgres: the app booted without DATABASE_URL'] };
  const retried = await prisma.prisma.subscriberDelivery.findMany({
    where: { createdAt: { gte: since }, attempts: { gt: 1 } },
    select: { subscriber: true, attempts: true, lastError: true },
    take: 20,
  });
  const failures = new Map<string, number>();
  for (const f of prismaFailures) failures.set(f, (failures.get(f) ?? 0) + 1);
  const bad = [
    ...[...failures].map(([line, n]) => `${line}${n > 1 ? ` (×${n})` : ''}`),
    ...retried.map((r) => `outbox retry: ${r.subscriber} ×${r.attempts}${r.lastError ? ` (${r.lastError.slice(0, 200)})` : ''}`),
  ];
  return {
    lines: [`Postgres: failed queries ${prismaFailures.length}, outbox deliveries retried ${retried.length}`],
    bad,
  };
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo, extra: Partial<RunOptions> = {}): Promise<{ code: number; report: SimulationReport | null }> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.error((err as Error).message);
    return { code: 2, report: null };
  }
  if (args.speed !== undefined && !args.quiet) io.log(`--speed ${args.speed} applies to the live Console mode; this in-process run goes as fast as it can.`);
  const since = new Date();
  const { app, prismaFailures } = await bootSimApp();
  try {
    // The invariants read the whole ledger: a database an earlier run (or anything else) wrote orders
    // to would mix its money in. Postgres runs start from a freshly migrated and seeded database.
    if (args.db === 'postgres' && (await app.get(PrismaService).prisma.order.count()) > 0) {
      io.error('--db postgres needs a freshly migrated and seeded database (this one already has orders)');
      return { code: 2, report: null };
    }
    const sim = app.get(SimulatorService);
    const { report } = await sim.run({
      orders: args.orders,
      drivers: args.drivers,
      restaurants: args.restaurants,
      ...(args.customers !== undefined ? { customers: args.customers } : {}),
      seed: args.seed,
      tickSec: args.tickSec,
      faults: args.faults,
      ...(args.quiet ? {} : { onProgress: (p) => io.log(`… ${p.simTime.toISOString().slice(11, 16)}Z placed ${p.placed}/${p.planned}, live ${p.live}, delivered ${p.delivered}, online ${p.driversOnline}, trips ${p.activeTrips}`) }),
      ...extra,
    });
    io.log(summaryTable(report));
    const path = args.report ?? (args.ci ? 'simulation-report.json' : undefined);
    if (path) {
      await io.writeFile(resolve(path), `${JSON.stringify(report, null, 2)}\n`);
      io.log(`report: ${resolve(path)}`);
    }
    for (const v of report.violations) io.error(`violation: ${v.invariant}`);
    let ok = report.ok;
    if (args.db === 'postgres') {
      const pg = await postgresChecks(app, prismaFailures, since);
      for (const l of pg.lines) io.log(l);
      for (const b of pg.bad) io.error(`postgres: ${b}`);
      if (pg.bad.length > 0) ok = false;
    }
    return { code: ok ? 0 : 1, report };
  } finally {
    await app.close();
  }
}
