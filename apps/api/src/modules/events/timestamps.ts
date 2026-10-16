import type { FlagReason } from './events.types.js';

/**
 * Evidence integrity (plan Step 3, edge-case §10). The server never trusts a phone's clock for
 * evidence: `recordedAt` is always server time. The device's `occurredAt` is kept and compared:
 *  - more than 60 s in the future → `device_ahead`;
 *  - more than 7 days in the past → `device_stale`;
 *  - otherwise beyond ±4 min → `device_skew`.
 * A flag is a mark for support and scoring, never a rejection.
 */
export const SKEW_POLICY = {
  aheadToleranceMs: 60_000,
  staleAfterMs: 7 * 86_400_000,
  maxSkewMs: 4 * 60_000,
} as const;

export interface SkewAssessment {
  /** occurredAt − recordedAt (positive: device ahead). */
  skewMs: number;
  flagged: boolean;
  flagReason: FlagReason | null;
}

export function assessSkew(occurredAt: Date, recordedAt: Date, policy: typeof SKEW_POLICY = SKEW_POLICY): SkewAssessment {
  const skewMs = occurredAt.getTime() - recordedAt.getTime();
  if (skewMs > policy.aheadToleranceMs) return { skewMs, flagged: true, flagReason: 'device_ahead' };
  if (skewMs < -policy.staleAfterMs) return { skewMs, flagged: true, flagReason: 'device_stale' };
  if (Math.abs(skewMs) > policy.maxSkewMs) return { skewMs, flagged: true, flagReason: 'device_skew' };
  return { skewMs, flagged: false, flagReason: null };
}

/**
 * Late replay (edge-case §10): an offline action for a (trip, order) pair received after the order
 * was detached from that trip. It is a replay when the device recorded it (it carries monotonic
 * uptime) or when it claims to have happened while the order was still attached. Server-side
 * events written at or after the detach (the detach event itself, the order's own follow-ups) are
 * not replays.
 */
export function isLateReplay(event: { occurredAt: Date; deviceUptimeMs?: number | undefined }, recordedAt: Date, detachedAt: Date | null): boolean {
  if (!detachedAt) return false;
  if (recordedAt.getTime() <= detachedAt.getTime()) return false;
  return event.deviceUptimeMs !== undefined || event.occurredAt.getTime() < detachedAt.getTime();
}

/** How long after the fact an event must arrive to count as offline-recorded when it has no uptime. */
export const OFFLINE_AFTER_MS = 60_000;

/** True for actions recorded on a device rather than by the server at receipt. */
export function isDeviceRecorded(event: { occurredAt: Date; recordedAt: Date; deviceUptimeMs?: number | undefined }): boolean {
  return event.deviceUptimeMs !== undefined || event.recordedAt.getTime() - event.occurredAt.getTime() > OFFLINE_AFTER_MS;
}

/** Outbox retry delay after the n-th failed attempt: 2^n seconds. */
export function backoffMs(attempts: number): number {
  return 2 ** attempts * 1000;
}

export const OUTBOX_MAX_ATTEMPTS = 10;

/**
 * How long a drain owns the rows it claimed. The claim commits at once (no row lock is held while
 * subscribers run); the claimed rows' next attempt moves this far ahead, so other drains skip them,
 * and if this process dies mid-batch they come back by themselves after it. Above the 2-minute cap on
 * a subscriber transaction, and a drain starts no new row after half of it (`OutboxPublisher`), so a
 * row is never delivered while another drain may hold it.
 */
export const OUTBOX_LEASE_MS = 5 * 60_000;
