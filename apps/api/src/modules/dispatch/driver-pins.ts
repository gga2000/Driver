import { OFFLINE_RECENT_AFTER_SEC } from '@driver/contracts';
import type { DriverPresence } from './geo-index.js';

/** Trip per driver from the live board: assigned (accepted) and offered (unanswered offer). */
export interface LiveJobs {
  assigned: ReadonlyMap<string, string>;
  offered: ReadonlyMap<string, string>;
}

/** What dispatch alone knows about a driver's state; cash caps are layered on by the Console reads. */
export type DispatchDriverState = 'free' | 'offered' | 'on_job' | 'offline_recent';

export interface LiveDriver {
  presence: DriverPresence;
  state: DispatchDriverState;
  /** The trip he is on, or the one he is being offered. */
  tripId: string | null;
}

/**
 * A driver's map state from presence and the board. A job wins over a stale heartbeat (he is
 * still carrying the order); otherwise a minute without a heartbeat reads as recently offline.
 */
export function liveDriver(p: DriverPresence, jobs: LiveJobs, nowMs: number): LiveDriver {
  const assigned = jobs.assigned.get(p.driverId);
  if (assigned) return { presence: p, state: 'on_job', tripId: assigned };
  if (nowMs - p.lastSeenAt > OFFLINE_RECENT_AFTER_SEC * 1000) return { presence: p, state: 'offline_recent', tripId: null };
  const offered = jobs.offered.get(p.driverId);
  if (offered) return { presence: p, state: 'offered', tripId: offered };
  return { presence: p, state: 'free', tripId: null };
}
