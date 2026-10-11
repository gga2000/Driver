import { DEMAND_GLOW_RULES, type PartnerDemandGlow, type PartnerDemandMap } from './partner-io.js';
import { haversineM } from './tracking.js';

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

/** One city's glow picture (N17): every lit zone, and the one busy zone picked for each free courier. */
export interface DemandGlowSnapshot {
  zones: Array<{ zoneId: string; level: 'hot' | 'warm' }>;
  picks: ReadonlyMap<string, string>;
  at: Date;
}

/**
 * N17: zones light only with `minDemand` jobs (waiting + expected); hot when that is more than the
 * online couriers there can take. Each hot zone is picked for as many free couriers as it is short
 * of, nearest first (within `maxKm`, ties by id), one zone per courier, the shortest zones first.
 */
export function demandGlow(input: {
  waitingZones: readonly string[];
  drivers: ReadonlyArray<{ driverId: string; zoneId: string | null; lat: number; lng: number; free: boolean }>;
  expected: ReadonlyMap<string, number>;
  centres: ReadonlyMap<string, { lat: number; lng: number }>;
  at: Date;
}): DemandGlowSnapshot {
  const zones = demandZones(
    input.waitingZones,
    input.drivers.map((d) => d.zoneId),
    input.expected,
  ).filter((z) => z.waiting + z.expected >= DEMAND_GLOW_RULES.minDemand);
  const short = zones
    .filter((z) => z.level === 'hot')
    .map((z) => ({ zoneId: z.zoneId, slots: Math.ceil(z.waiting + z.expected - z.drivers) }))
    .sort((a, b) => b.slots - a.slots || a.zoneId.localeCompare(b.zoneId));
  const picks = new Map<string, string>();
  for (const z of short) {
    const centre = input.centres.get(z.zoneId);
    if (!centre) continue;
    const near = input.drivers
      .filter((d) => d.free && d.zoneId !== z.zoneId && !picks.has(d.driverId))
      .map((d) => ({ id: d.driverId, m: haversineM(centre, d) }))
      .filter((d) => d.m <= DEMAND_GLOW_RULES.maxKm * 1000)
      .sort((a, b) => a.m - b.m || a.id.localeCompare(b.id))
      .slice(0, z.slots);
    for (const d of near) picks.set(d.id, z.zoneId);
  }
  return { zones: zones.map((z) => ({ zoneId: z.zoneId, level: z.level === 'hot' ? 'hot' : 'warm' })), picks, at: input.at };
}

/** One courier's view of the picture: his picked zone stays hot; every other busy zone reads warm. */
export function glowFor(snap: DemandGlowSnapshot, driverId: string): PartnerDemandGlow {
  const mine = snap.picks.get(driverId) ?? null;
  return {
    zones: snap.zones.map((z) => ({ zoneId: z.zoneId, level: z.zoneId === mine ? 'hot' : 'warm', forYou: z.zoneId === mine })),
    at: snap.at,
  };
}
