import 'reflect-metadata';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { FAULTS, INVARIANTS, SimulatorService, checkInvariants, injectFault, type SimSnapshot, type SimulationReport } from './modules/simulator/index.js';
import { bootSimApp, parseArgs, runCli, type CliIo } from './sim-cli.js';

/**
 * The Aziziyah simulator end to end (plan Step 7) on the real app wiring (`AppModule`, in memory,
 * fake clock, pollers off): a 200-order day with zero violations and ≥ 90 % delivered, every
 * invariant proven to fire on a deliberately broken snapshot, and the CLI gate exiting 1.
 */
describe('simulator: a 200-order Aziziyah day through the real services', () => {
  let app: INestApplicationContext;
  let report: SimulationReport;
  let snapshot: SimSnapshot;

  beforeAll(async () => {
    ({ app } = await bootSimApp());
    ({ report, snapshot } = await app.get(SimulatorService).run({ orders: 200, seed: 1 }));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('ends with zero violations and at least 90 % of orders delivered', () => {
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.orders.placed).toBeGreaterThanOrEqual(195);
    expect(report.orders.deliveredShare).toBeGreaterThanOrEqual(0.9);
    expect(report.run.supply).toEqual({ bike: 10, tuktuk: 25, car: 25 });
  });

  it('every invariant actually checked something on a real day', () => {
    const byName = new Map(report.invariants.map((i) => [i.name, i]));
    expect([...byName.keys()]).toEqual(INVARIANTS.map((i) => i.name));
    for (const name of ['ledger_money_balanced', 'ledger_points_balanced', 'orders_terminal', 'trips_terminal', 'stop_completed_after_arrived', 'completed_trip_has_no_pending_stop', 'outbox_drained', 'idempotent_replays', 'fee_within_fare', 'customer_cash_rounds_to_250', 'no_offer_to_over_cap_driver', 'no_points_on_money_accounts', 'one_balanced_group_per_closed_order', 'merchant_cash_reconciles', 'points_per_food_order_capped', 'shift_guarantee_once_and_exact', 'night_ride_starts_with_the_code']) {
      expect(byName.get(name)!.checked, name).toBeGreaterThan(0);
    }
  });

  it('reports terminal states, p50/p95 timings and the revenue split', () => {
    const total = Object.values(report.orders.byState).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.orders.placed);
    expect(Object.keys(report.orders.byState).every((s) => ['closed', 'customer_cancelled', 'merchant_rejected', 'platform_cancelled', 'refunded', 'failed'].includes(s))).toBe(true);
    expect(report.timings.timeToAcceptSec.food.p50).toBeGreaterThan(0);
    expect(report.timings.timeToAcceptSec.ride.p95).toBeGreaterThanOrEqual(report.timings.timeToAcceptSec.ride.p50!);
    expect(report.timings.timeToDeliverSec.food.p95).toBeGreaterThanOrEqual(report.timings.timeToDeliverSec.food.p50!);
    expect(report.revenue.platformIqd).toBeGreaterThan(0);
    expect(report.revenue.couriersIqd).toBeGreaterThan(0);
    expect(report.revenue.merchantsIqd).toBeGreaterThan(report.revenue.platformIqd);
    expect(report.activity.merchantHandovers).toBeGreaterThan(0);
  });

  describe('each invariant fires when its rule is deliberately broken', () => {
    it('the clean snapshot passes every check', () => {
      expect(checkInvariants(snapshot).filter((i) => i.violations > 0)).toEqual([]);
    });

    it.each(INVARIANTS.map((i) => i.name))('%s', (name) => {
      expect(FAULTS[name], `a fault for ${name}`).toBeDefined();
      const broken = structuredClone(snapshot);
      injectFault(broken, name);
      const result = checkInvariants(broken).find((i) => i.name === name)!;
      expect(result.violations, name).toBeGreaterThan(0);
      expect(result.examples.length).toBeGreaterThan(0);
    });
  });
});

describe('simulator: determinism', () => {
  it('the same seed gives the same day, number for number', async () => {
    const once = async () => {
      const { app } = await bootSimApp();
      try {
        const { report } = await app.get(SimulatorService).run({ orders: 40, drivers: 12, restaurants: 4, seed: 3 });
        const { run, ...rest } = report;
        return { rest, refusals: run.refusals };
      } finally {
        await app.close();
      }
    };
    expect(await once()).toEqual(await once());
  }, 120_000);
});

describe('simulator CLI (`pnpm sim`)', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    const files = new Map<string, string>();
    const sink: CliIo = { log: (l) => out.push(l), error: (l) => err.push(l), writeFile: async (p, c) => void files.set(p, c) };
    return { sink, out, err, files };
  };

  it('parses the documented flags', () => {
    expect(parseArgs(['--orders', '2000', '--drivers', '60', '--restaurants', '10', '--seed', '1', '--ci'])).toMatchObject({ orders: 2000, drivers: 60, restaurants: 10, seed: 1, ci: true, report: undefined, faults: [] });
    expect(() => parseArgs(['--inject-fault', 'nope'])).toThrow('unknown invariant');
  });

  it('exits 0 and writes simulation-report.json with --ci when nothing is violated', async () => {
    const { sink, out, files } = io();
    const { code, report } = await runCli(['--orders', '30', '--drivers', '10', '--restaurants', '3', '--seed', '1', '--ci', '--quiet'], sink);
    expect(code).toBe(0);
    expect(report!.violations).toEqual([]);
    const [path, json] = [...files.entries()][0]!;
    expect(path.endsWith('simulation-report.json')).toBe(true);
    expect(JSON.parse(json)).toMatchObject({ ok: true, violations: [], run: { seed: 1, orders: 30 } });
    expect(out.join('\n')).toContain('Invariants passed');
    expect(out.join('\n')).toContain('الثوابت');
  }, 120_000);

  it('exits 1 on a violation and names it, in the log and in the report', async () => {
    const { sink, err } = io();
    const dir = await mkdtemp(join(tmpdir(), 'sim-'));
    const path = join(dir, 'report.json');
    const real: CliIo = { ...sink, writeFile: async (p, c) => (await import('node:fs/promises')).writeFile(p, c, 'utf8') };
    const { code } = await runCli(['--orders', '30', '--drivers', '10', '--restaurants', '3', '--seed', '1', '--report', path, '--inject-fault', 'ledger_money_balanced', '--quiet'], real);
    expect(code).toBe(1);
    expect(err).toContain('violation: ledger_money_balanced');
    const written = JSON.parse(await readFile(path, 'utf8')) as SimulationReport;
    expect(written.ok).toBe(false);
    expect(written.violations.map((v) => v.invariant)).toContain('ledger_money_balanced');
  }, 120_000);
});
