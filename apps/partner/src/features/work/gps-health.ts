import { useEffect, useState } from 'react';

/** No usable fix for this long on a job: the customer's map has stopped moving (step 6, n7). */
export const GPS_WEAK_AFTER_MS = 30_000;
const CHECK_MS = 5_000;

interface GpsHealth {
  /** The last fix accurate enough to send (ms), 0 before any. */
  goodAt: number;
  /** The phone answered with a position at all, even a poor one. */
  seen: boolean;
}

const health: GpsHealth = { goodAt: 0, seen: false };

/** Called on each job position tick (`useJobPositions`): `good` = accurate enough to send. */
export function noteJobFix(good: boolean, now: number): void {
  health.seen = true;
  if (good) health.goodAt = now;
}

/** Test hook. */
export function resetGpsHealth(): void {
  health.goodAt = 0;
  health.seen = false;
}

/** The customer's map has stopped moving: `lastSeenMin` = minutes since his last good position, null if none yet. */
export interface GpsWeak {
  lastSeenMin: number | null;
}

/**
 * Weak: on a job, the phone gives positions but none good enough for 30 s (counted from the later of the
 * last good one and when the job screen opened). No position at all is the GPS chip's case (permission,
 * location off), not this.
 */
export function gpsWeakFor(h: GpsHealth, since: number, now: number): GpsWeak | null {
  if (!h.seen) return null;
  if (now - Math.max(h.goodAt, since) < GPS_WEAK_AFTER_MS) return null;
  return { lastSeenMin: h.goodAt > 0 ? Math.max(1, Math.floor((now - h.goodAt) / 60_000)) : null };
}

/** For the job screen: whether his GPS is too weak for the customer's map, re-checked every 5 s. */
export function useGpsWeak(onJob: boolean): GpsWeak | null {
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!onJob) return;
    const id = setInterval(() => setNow(Date.now()), CHECK_MS);
    return () => clearInterval(id);
  }, [onJob]);
  return onJob ? gpsWeakFor(health, since, now) : null;
}
