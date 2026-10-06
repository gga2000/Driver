import { REPLAY_RULES, TRAIL_RETENTION_DAYS, type EventLogEntry, type OrderReplay } from '@driver/contracts';

const DAY_MS = 86_400_000;

/** Keeps at most `max` points, evenly spread, always the first and the last (the replay's ends). */
export function thinPoints<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

/** The moments on the replay's timeline: the types that matter, once each, in time order. */
export function replayMarks(events: readonly EventLogEntry[]): OrderReplay['marks'] {
  const seen = new Set<string>();
  return events
    .filter((e) => REPLAY_RULES.marks.includes(e.type) && !e.quarantined)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => ({ id: e.id, type: e.type, at: e.occurredAt, lat: e.location?.lat ?? null, lng: e.location?.lng ?? null }));
}

/** The path is gone (retention) when no trip kept a point and the last one ended over 30 days ago. */
export function trailPurged(pointCount: number, lastActivity: Date | null, now: Date): boolean {
  return pointCount === 0 && lastActivity !== null && now.getTime() - lastActivity.getTime() > TRAIL_RETENTION_DAYS * DAY_MS;
}
