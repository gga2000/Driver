import { useSyncExternalStore } from 'react';

/**
 * Auto-arrive (maps program d4): the server says which stops he is within 60 m of (`armed`, from each
 * position report); the app asks "وصلت؟" once he has also been slow (under 10 km/h) for 10 s there —
 * stopped at the door, not driving past it. It only asks: arriving still takes his tap.
 */
export const AUTO_ARRIVE = {
  /** Slower than this counts as stopped. */
  stillKmh: 10,
  /** …for this long. */
  stillMs: 10_000,
  /** An `armed` answer older than this is forgotten (he left, or reports stopped). */
  armedTtlMs: 20_000,
} as const;

export interface ArriveWatch {
  /** Since when he has been slow inside the current stop's geofence; null when not. */
  slowSince: number | null;
  /** Stops he answered "مو بعد" for; asked again only after he leaves the geofence and comes back. */
  dismissed: ReadonlySet<string>;
}

export const NO_WATCH: ArriveWatch = { slowSince: null, dismissed: new Set() };

export interface ArriveInput {
  stopId: string | null;
  /** The stop is still to arrive at (`pending`). */
  pending: boolean;
  /** The server's armed stops, fresh. */
  armed: ReadonlySet<string>;
  /** His last speed; unknown counts as slow (web, some phones). */
  speedKmh: number | null;
  now: number;
}

/** One step of the watch: the next state and whether the "وصلت؟" sheet shows. */
export function watchArrival(w: ArriveWatch, i: ArriveInput): { watch: ArriveWatch; ask: boolean } {
  // Leaving a geofence clears its "not yet", so coming back asks again.
  const dismissed = new Set([...w.dismissed].filter((id) => i.armed.has(id)));
  const inside = i.stopId !== null && i.pending && i.armed.has(i.stopId);
  if (!inside) return { watch: { slowSince: null, dismissed }, ask: false };
  const slow = i.speedKmh === null || i.speedKmh < AUTO_ARRIVE.stillKmh;
  const slowSince = slow ? (w.slowSince ?? i.now) : null;
  const ask = slowSince !== null && i.now - slowSince >= AUTO_ARRIVE.stillMs && !dismissed.has(i.stopId!);
  return { watch: { slowSince, dismissed }, ask };
}

/** "مو بعد": don't ask again for this stop until he leaves and comes back. */
export function dismissArrival(w: ArriveWatch, stopId: string): ArriveWatch {
  return { ...w, dismissed: new Set([...w.dismissed, stopId]) };
}

// ───────────────────────── what the position reports said ─────────────────────────

interface Reported {
  armed: ReadonlySet<string>;
  speedKmh: number | null;
  at: number;
}
let last: Reported = { armed: new Set(), speedKmh: null, at: 0 };
const listeners = new Set<() => void>();

/** Called by the position reporter with each answer (and the fix it sent). */
export function reportArmed(stopIds: readonly string[], speedKmh: number | null, at: number): void {
  last = { armed: new Set(stopIds), speedKmh, at };
  for (const l of listeners) l();
}

/** The latest answer; empty once it is older than `armedTtlMs`. */
export function useArmed(now: number): Reported {
  const r = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => last,
    () => last,
  );
  return now - r.at > AUTO_ARRIVE.armedTtlMs ? { armed: new Set(), speedKmh: null, at: r.at } : r;
}
