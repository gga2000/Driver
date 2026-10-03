import type { UnreachableStatus } from '@driver/contracts';
import { jobKey } from '../../shared/queue.js';

/**
 * Unreachable-customer protocol (domain §2): the courier taps "can't reach" at the door → automatic
 * call/WhatsApp → a visible 5-minute timer → dispatcher alerted at minute 3 → `failed` allowed at
 * minute 5 (dispatcher may fail from minute 3) → order disputed with its default outcome.
 *
 * Timers run as delayed queue jobs (BullMQ in production, `InMemoryQueue` in tests); the jobs only
 * announce (dispatcher card, "فشل" armed). The fail permission itself is always re-checked against
 * the clock, so a lost or late job can never let a driver fail early.
 */
export const UNREACHABLE_ESCALATE_AFTER_MS = 3 * 60_000;
export const UNREACHABLE_FAIL_AFTER_MS = 5 * 60_000;

export const UNREACHABLE_JOBS = {
  escalate: 'unreachable.escalate',
  allowFail: 'unreachable.allowFail',
} as const;

export interface UnreachableTimerJob {
  tripId: string;
  stopId: string | null;
  /** The protocol run this job belongs to; a restarted protocol makes older jobs no-ops. */
  startedAtMs: number;
}

export type FailRole = 'driver' | 'dispatcher';

export function failAllowedAfterMs(role: FailRole): number {
  return role === 'dispatcher' ? UNREACHABLE_ESCALATE_AFTER_MS : UNREACHABLE_FAIL_AFTER_MS;
}

/** May `role` fail the trip at `now` given the protocol started at `startedAt`? */
export function canFail(startedAt: Date | null, now: Date, role: FailRole): boolean {
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() >= failAllowedAfterMs(role);
}

export function unreachableStatus(input: { stopId: string | null; startedAt: Date | null; escalatedAt: Date | null }): UnreachableStatus | null {
  if (!input.startedAt) return null;
  const t = input.startedAt.getTime();
  return {
    stopId: input.stopId,
    startedAt: input.startedAt,
    escalatedAt: input.escalatedAt,
    escalateAt: new Date(t + UNREACHABLE_ESCALATE_AFTER_MS),
    failAllowedAt: new Date(t + UNREACHABLE_FAIL_AFTER_MS),
  };
}

/** Stable job ids so a retried `startUnreachable` never schedules the timers twice. */
export function unreachableJobId(kind: keyof typeof UNREACHABLE_JOBS, tripId: string, startedAtMs: number): string {
  return jobKey('trip', tripId, 'unreachable', kind, startedAtMs);
}
