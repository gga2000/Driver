import type { BroadcastWave, DispatchConfig } from '@driver/contracts';
import type { DispatchJob, DispatchPlan, DriverCandidate, Policy, Wave } from './policy.js';

export const DEFAULT_WAVES: BroadcastWave[] = [
  { size: 3, seconds: 15 },
  { size: 5, seconds: 15 },
  { size: 'all', seconds: 30 },
];

/**
 * Waves of ranked nearby drivers; first accept wins. Wave sizes are cumulative slices of the
 * ranked list: 3 drivers, then the next 5, then everyone remaining.
 */
export class SmartBroadcastPolicy implements Policy {
  readonly kind = 'smart_broadcast' as const;

  plan(_job: DispatchJob, ranked: DriverCandidate[], config: DispatchConfig): DispatchPlan {
    const waves = buildWaves(
      ranked.map((d) => d.driverId),
      config.waves ?? DEFAULT_WAVES,
    );
    if (waves.length === 0) return { kind: 'no_drivers' };
    return { kind: 'broadcast', waves, acceptTimeoutSec: config.acceptTimeoutSec };
  }
}

export function buildWaves(driverIds: readonly string[], spec: readonly BroadcastWave[]): Wave[] {
  const waves: Wave[] = [];
  let cursor = 0;
  for (const [i, w] of spec.entries()) {
    if (cursor >= driverIds.length) break;
    const end = w.size === 'all' ? driverIds.length : Math.min(driverIds.length, cursor + w.size);
    const ids = driverIds.slice(cursor, end);
    if (ids.length === 0) break;
    waves.push({ index: i, driverIds: ids, seconds: w.seconds });
    cursor = end;
  }
  return waves;
}

/**
 * Machine assigns the best driver. Up to `maxBatch` orders in one zone may share a courier:
 * `batchWith` lists the ids of the courier's active trips in the same zone to merge into.
 */
export class AutoAssignPolicy implements Policy {
  readonly kind = 'auto_assign' as const;

  constructor(private readonly activeTripsInZone: (driverId: string, zoneId: string) => string[] = () => []) {}

  plan(job: DispatchJob, ranked: DriverCandidate[], config: DispatchConfig): DispatchPlan {
    const best = ranked.find((d) => d.activeTrips < config.maxBatch);
    if (!best) return { kind: 'no_drivers' };
    const batchWith = best.activeTrips > 0 ? this.activeTripsInZone(best.driverId, job.zoneId) : [];
    return { kind: 'assign', driverId: best.driverId, batchWith, acceptTimeoutSec: config.acceptTimeoutSec };
  }
}

/** Departures planned in advance; seats are filled and ops confirms the car. */
export class ScheduledPolicy implements Policy {
  readonly kind = 'scheduled' as const;

  plan(job: DispatchJob): DispatchPlan {
    if (!job.routeId || !job.departureAt) return { kind: 'no_drivers' };
    return { kind: 'schedule', routeId: job.routeId, departureAt: job.departureAt, needsOpsConfirmation: true };
  }
}

/**
 * Route driver is fixed. If absent, a substitute auction opens among vetted drivers
 * with identical stops (the caller filters candidates to that set).
 */
export class PreAssignedPolicy implements Policy {
  readonly kind = 'pre_assigned' as const;

  plan(job: DispatchJob, ranked: DriverCandidate[], config: DispatchConfig): DispatchPlan {
    const fixed = job.routeDriverId;
    if (fixed && ranked.some((d) => d.driverId === fixed)) {
      return { kind: 'pre_assigned', driverId: fixed, acceptTimeoutSec: config.acceptTimeoutSec };
    }
    const vetted = ranked.filter((d) => d.vetted).map((d) => d.driverId);
    if (vetted.length === 0) return { kind: 'no_drivers' };
    return { kind: 'substitute_auction', driverIds: vetted, acceptTimeoutSec: config.acceptTimeoutSec };
  }
}
