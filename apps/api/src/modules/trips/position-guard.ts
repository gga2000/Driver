import { POSITION_RULES, type DeviceFix, type LatLng, type PositionRejectReason } from '@driver/contracts';
import { haversineMeters } from './geofence.js';

export type FixVerdict =
  | { kind: 'reject'; reason: PositionRejectReason }
  /**
   * Store it. `live`: also arms geofences, schedules ride auto-complete and reaches the live map (a late
   * replay is trail only). `at` may be clamped to server time. `jump`: implausibly far from the last fix.
   */
  | { kind: 'accept'; at: Date; live: boolean; jump: boolean };

/**
 * The API's judgement on one fix from a driver's phone, given his last stored fix (maps program SP4a).
 * Pure: the caller stores, fans out and counts suspicion. Jumps are flagged, never refused — one GPS
 * glitch must not freeze a customer's tracking.
 */
export function assessFix(fix: DeviceFix, last: { at: Date; pin: LatLng } | null, now: Date, rules: typeof POSITION_RULES = POSITION_RULES): FixVerdict {
  if (fix.mocked) return { kind: 'reject', reason: 'mocked' };
  if (fix.accuracyM !== undefined && fix.accuracyM > rules.maxAccuracyM) return { kind: 'reject', reason: 'inaccurate' };
  const at = fix.at.getTime() > now.getTime() + rules.maxAheadMs ? now : fix.at;
  if (last && at.getTime() <= last.at.getTime()) return { kind: 'reject', reason: 'out_of_order' };
  const live = now.getTime() - at.getTime() <= rules.liveMaxAgeMs;
  let jump = false;
  if (last) {
    const metres = haversineMeters(last.pin, fix.pin);
    const hours = (at.getTime() - last.at.getTime()) / 3_600_000;
    jump = metres > rules.jumpMinM && metres / 1000 / hours > rules.jumpKmh;
  }
  return { kind: 'accept', at, live, jump };
}
