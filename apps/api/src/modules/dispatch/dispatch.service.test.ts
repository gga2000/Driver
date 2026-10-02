import { describe, expect, it } from 'vitest';
import { ConfigService } from '../config/index.js';
import { DispatchService } from './dispatch.service.js';
import { AutoAssignPolicy, PreAssignedPolicy, SmartBroadcastPolicy, buildWaves } from './policies.js';
import type { DispatchJob, DriverCandidate } from './policy.js';
import { DriverRanker } from './ranker.js';

const config = new ConfigService();
const service = new DispatchService(config);

const drivers = (n: number, extra: Partial<DriverCandidate> = {}): DriverCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    driverId: `d${String(i + 1).padStart(2, '0')}`,
    distanceKm: i * 0.5,
    activeTrips: 0,
    tier: 'bronze',
    ...extra,
  }));

const job = (partial: Partial<DispatchJob> = {}): DispatchJob => ({
  tripId: 't1',
  cityId: 'aziziyah',
  vertical: 'taxi',
  zoneId: 'center',
  ...partial,
});

describe('policy selection by (city, vertical)', () => {
  it.each([
    ['taxi', 'smart_broadcast'],
    ['tuktuk', 'smart_broadcast'],
    ['food', 'auto_assign'],
    ['grocery', 'auto_assign'],
    ['intercity', 'scheduled'],
    ['khat', 'pre_assigned'],
  ] as const)('%s → %s', (vertical, kind) => {
    expect(service.policyFor('aziziyah', vertical).kind).toBe(kind);
  });

  it('fails loudly for an unconfigured city', () => {
    expect(() => service.policyFor('kut', 'taxi')).toThrow(/no dispatch config/);
  });
});

describe('smart_broadcast waves', () => {
  it('builds 3 / 5 / all waves with 15 / 15 / 30 second windows', () => {
    const plan = service.plan(job(), drivers(12));
    expect(plan.kind).toBe('broadcast');
    if (plan.kind !== 'broadcast') return;
    expect(plan.waves.map((w) => w.driverIds.length)).toEqual([3, 5, 4]);
    expect(plan.waves.map((w) => w.seconds)).toEqual([15, 15, 30]);
    expect(plan.waves[0]?.driverIds).toEqual(['d01', 'd02', 'd03']);
    expect(plan.waves[1]?.driverIds).toEqual(['d04', 'd05', 'd06', 'd07', 'd08']);
    expect(plan.acceptTimeoutSec).toBe(15);
    // No driver appears twice.
    const all = plan.waves.flatMap((w) => w.driverIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('drops empty trailing waves when few drivers are nearby', () => {
    expect(buildWaves(['a', 'b'], [{ size: 3, seconds: 15 }, { size: 5, seconds: 15 }, { size: 'all', seconds: 30 }])).toEqual([
      { index: 0, driverIds: ['a', 'b'], seconds: 15 },
    ]);
    expect(buildWaves(['a', 'b', 'c', 'd'], [{ size: 3, seconds: 15 }, { size: 5, seconds: 15 }])).toEqual([
      { index: 0, driverIds: ['a', 'b', 'c'], seconds: 15 },
      { index: 1, driverIds: ['d'], seconds: 15 },
    ]);
  });

  it('returns no_drivers when nobody is online', () => {
    expect(service.plan(job(), [])).toEqual({ kind: 'no_drivers' });
  });

  it('orders waves by rank: gold and nearer drivers first', () => {
    const ranked = new DriverRanker().rank([
      { driverId: 'far-gold', distanceKm: 3, activeTrips: 0, tier: 'gold' },
      { driverId: 'near-bronze', distanceKm: 0.5, activeTrips: 0, tier: 'bronze' },
      { driverId: 'near-busy', distanceKm: 0.2, activeTrips: 1, tier: 'silver' },
      { driverId: 'mid-silver', distanceKm: 1, activeTrips: 0, tier: 'silver' },
    ]);
    // silver 1 km: 10 − 10 = 0 · bronze 0.5 km: 0 − 5 = −5 · gold 3 km: 20 − 30 = −10 · busy: 10 − 2 − 25 = −17
    expect(ranked.map((d) => d.driverId)).toEqual(['mid-silver', 'near-bronze', 'far-gold', 'near-busy']);
    expect(ranked.map((d) => d.score)).toEqual([0, -5, -10, -17]);
    const plan = new SmartBroadcastPolicy().plan(job(), ranked, service.configFor('aziziyah', 'taxi'));
    expect(plan.kind === 'broadcast' && plan.waves[0]?.driverIds).toEqual(['mid-silver', 'near-bronze', 'far-gold']);
  });
});

describe('auto_assign', () => {
  it('assigns the best driver with capacity and batches up to maxBatch in one zone', () => {
    const policy = new AutoAssignPolicy((driverId, zoneId) => (driverId === 'd01' && zoneId === 'center' ? ['t0'] : []));
    const cfg = service.configFor('aziziyah', 'food');
    expect(cfg.maxBatch).toBe(2);
    const ranked = new DriverRanker().rank(drivers(3, { activeTrips: 1 }));
    const plan = policy.plan(job({ vertical: 'food' }), ranked, cfg);
    expect(plan).toEqual({ kind: 'assign', driverId: 'd01', batchWith: ['t0'], acceptTimeoutSec: 20 });
  });

  it('skips drivers already at the batch limit', () => {
    const ranked = new DriverRanker().rank([
      { driverId: 'full', distanceKm: 0.1, activeTrips: 2, tier: 'gold' },
      { driverId: 'free', distanceKm: 2, activeTrips: 0, tier: 'bronze' },
    ]);
    const plan = service.plan(job({ vertical: 'food' }), ranked);
    expect(plan.kind === 'assign' && plan.driverId).toBe('free');
  });
});

describe('scheduled and pre_assigned', () => {
  it('scheduled plans a departure needing ops confirmation', () => {
    const departureAt = new Date('2026-10-03T06:00:00Z');
    const plan = service.plan(job({ vertical: 'intercity', routeId: 'r-kut-0600', departureAt }), drivers(2));
    expect(plan).toEqual({ kind: 'schedule', routeId: 'r-kut-0600', departureAt, needsOpsConfirmation: true });
  });

  it('pre_assigned keeps the route driver when present', () => {
    const plan = service.plan(job({ vertical: 'khat', routeId: 'k1', routeDriverId: 'd02' }), drivers(3));
    expect(plan).toEqual({ kind: 'pre_assigned', driverId: 'd02', acceptTimeoutSec: 60 });
  });

  it('pre_assigned opens a substitute auction among vetted drivers when the route driver is absent', () => {
    const candidates: DriverCandidate[] = [
      { driverId: 'v1', distanceKm: 1, activeTrips: 0, tier: 'silver', vetted: true },
      { driverId: 'x1', distanceKm: 0.5, activeTrips: 0, tier: 'gold', vetted: false },
      { driverId: 'v2', distanceKm: 2, activeTrips: 0, tier: 'gold', vetted: true },
    ];
    const plan = new PreAssignedPolicy().plan(
      job({ vertical: 'khat', routeDriverId: 'absent' }),
      new DriverRanker().rank(candidates),
      service.configFor('aziziyah', 'khat'),
    );
    expect(plan.kind).toBe('substitute_auction');
    expect(plan.kind === 'substitute_auction' && plan.driverIds.sort()).toEqual(['v1', 'v2']);
  });
});

describe('suggest-only mode', () => {
  it('wraps the plan for the console', () => {
    const suggestConfig = new ConfigService();
    const city = suggestConfig.city('aziziyah')!;
    city.dispatch.taxi!.suggestOnly = true;
    const svc = new DispatchService(suggestConfig);
    const plan = svc.plan(job(), drivers(2));
    expect(plan.kind).toBe('suggest');
    expect(plan.kind === 'suggest' && plan.suggestion.kind).toBe('broadcast');
  });
});
