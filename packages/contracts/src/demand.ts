import type { PartnerDemandMap } from './partner-io.js';

/**
 * Where the work is (maps program d5 for drivers, o5 for the Console): pure rules shared by the
 * driver's home map and the Console's busy-zone heat.
 */

/** Board statuses that mean "a job is waiting for a driver". */
export const WAITING_STATUSES: ReadonlySet<string> = new Set(['searching', 'rebroadcast', 'needs_dispatcher', 'awaiting_dispatcher']);

/**
 * The driver map's busy zones (maps program d5): per zone, the jobs waiting now plus the pickups this
 * hour usually brings (`expected`, the weekly average), against the online drivers there. Hot when
 * that demand is at least 2 and more than the drivers can take; warm from 1; calm otherwise. Zones
 * with nothing going on are left out.
 */
export function demandZones(waitingZones: readonly string[], driverZones: ReadonlyArray<string | null>, expected: ReadonlyMap<string, number>): PartnerDemandMap['zones'] {
  const waiting = new Map<string, number>();
  for (const z of waitingZones) waiting.set(z, (waiting.get(z) ?? 0) + 1);
  const drivers = new Map<string, number>();
  for (const z of driverZones) if (z) drivers.set(z, (drivers.get(z) ?? 0) + 1);
  const ids = new Set([...waiting.keys(), ...drivers.keys(), ...[...expected].filter(([, n]) => n >= 0.5).map(([z]) => z)]);
  return [...ids].sort().map((zoneId) => {
    const w = waiting.get(zoneId) ?? 0;
    const e = Math.round((expected.get(zoneId) ?? 0) * 10) / 10;
    const d = drivers.get(zoneId) ?? 0;
    const demand = w + e;
    const level = demand >= 2 && demand > d ? 'hot' : demand >= 1 ? 'warm' : 'calm';
    return { zoneId, waiting: w, expected: e, drivers: d, level };
  });
}

/** The forecast windows: this coming hour on the same weekday, `weeks` weeks back. */
export function forecastWindows(now: Date, weeks: number): Array<{ from: Date; to: Date }> {
  const WEEK = 7 * 86_400_000;
  return Array.from({ length: weeks }, (_, i) => ({ from: new Date(now.getTime() - (i + 1) * WEEK), to: new Date(now.getTime() - (i + 1) * WEEK + 3_600_000) }));
}
