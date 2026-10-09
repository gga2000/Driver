import type { VehicleClass } from '@driver/contracts';
import { HEARTBEAT_MS } from './presence-timing';

/**
 * Background location (maps program SP1 f2): while the driver is online or on a job and the app is not
 * on screen, the OS hands the app his fixes and the background task keeps him in the dispatch index and
 * feeds the customer's map. This file is the task's pure decision logic (tested in Node); the native
 * wiring lives in `lib/background-location.native.ts`.
 */

/** The OS task name (one per app). */
export const BACKGROUND_LOCATION_TASK = 'driver.partner.background-location';
/** Storage key for what the task needs when it wakes without the app's React tree. */
export const BACKGROUND_STATE_KEY = 'driver.partner.background-state';
/** Ask the OS for a fix at most this often, and only after this much movement (on a job). */
export const BACKGROUND_INTERVAL_MS = 5_000;
export const BACKGROUND_DISTANCE_M = 10;

/**
 * How hard the OS works for a fix (partner redesign b1, battery). On a job the customer watches him on
 * the map: precise GPS every 5 s after 10 m of movement. Waiting for an offer only the 30 s heartbeat
 * needs him, and dispatch needs his zone, not his metre: the phone's balanced fix (cell + Wi-Fi, GPS
 * only when needed) twice per heartbeat (a late wake still beats inside presence's 90 s), with no
 * distance filter so a parked courier still wakes the task and keeps his place in dispatch.
 */
export interface TrackingProfile {
  accuracy: 'high' | 'balanced';
  intervalMs: number;
  distanceM: number;
}

export const JOB_TRACKING: TrackingProfile = { accuracy: 'high', intervalMs: BACKGROUND_INTERVAL_MS, distanceM: BACKGROUND_DISTANCE_M };
export const WAITING_TRACKING: TrackingProfile = { accuracy: 'balanced', intervalMs: HEARTBEAT_MS / 2, distanceM: 0 };

export function trackingProfile(s: Pick<BackgroundState, 'onJob'>): TrackingProfile {
  return s.onJob ? JOB_TRACKING : WAITING_TRACKING;
}

/** What the running shift needs from the background task. */
export interface BackgroundState {
  online: boolean;
  onJob: boolean;
  vehicleClass: VehicleClass | null;
}

/** Run the OS location service only while there is something to report. */
export function wantsBackgroundTracking(s: BackgroundState): boolean {
  return s.online || s.onJob;
}

export interface BackgroundPlan {
  /** Re-send `partner.goOnline` (presence lapses after 90 s without it). */
  heartbeat: boolean;
  /** Send the buffered fixes with `trips.reportPositions`. */
  reportPositions: boolean;
}

/**
 * What one wake of the task sends. While the app is on screen its own hooks (`usePresence`,
 * `useJobPositions`) do the work, so the task stays quiet and nothing goes twice.
 */
export function planBackgroundWake(input: { state: BackgroundState | null; appActive: boolean; lastBeatAt: number; now: number }): BackgroundPlan {
  const { state, appActive, lastBeatAt, now } = input;
  if (!state || appActive) return { heartbeat: false, reportPositions: false };
  return {
    heartbeat: state.online && now - lastBeatAt >= HEARTBEAT_MS,
    reportPositions: state.onJob,
  };
}

export function parseBackgroundState(raw: string | null): BackgroundState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BackgroundState>;
    if (typeof v.online !== 'boolean' || typeof v.onJob !== 'boolean') return null;
    return { online: v.online, onJob: v.onJob, vehicleClass: (v.vehicleClass ?? null) as VehicleClass | null };
  } catch {
    return null;
  }
}
