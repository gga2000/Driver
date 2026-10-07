import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Alert } from 'react-native';
import { POSITION_RULES } from '@driver/contracts';
import {
  BACKGROUND_DISTANCE_M,
  BACKGROUND_INTERVAL_MS,
  BACKGROUND_LOCATION_TASK,
  BACKGROUND_STATE_KEY,
  parseBackgroundState,
  planBackgroundWake,
  wantsBackgroundTracking,
  type BackgroundState,
} from '@/features/work/background-plan';
import { FixBuffer, toDeviceFix, worthSending } from '@/features/work/position-report';
import { apiErrorCode } from './api-links';
import { makeApiClient } from './api';
import { fixFrom, type Fix } from './location-fix';
import { session } from './session';
import { storage } from './storage';

/**
 * Background location (maps program SP1 f2): `expo-location` updates through `expo-task-manager`, with
 * Android's foreground service and its visible notification, iOS `UIBackgroundModes: location`. Runs only
 * while the driver is online or on a job; the decisions are `features/work/background-plan.ts`.
 *
 * The task is defined when this module loads (the app's root layout imports it), so the OS can wake it
 * with the app in the background. It talks to the API with its own client on the stored session.
 */

export interface BackgroundCopy {
  notificationTitle: string;
  notificationBody: string;
  disclosureTitle: string;
  disclosureBody: string;
  disclosureAllow: string;
  disclosureLater: string;
}

let state: BackgroundState | null = null;
let lastBeatAt = 0;
let prev: Fix | null = null;
let sending = false;
const buffer = new FixBuffer();
let client: ReturnType<typeof makeApiClient> | null = null;

async function currentState(): Promise<BackgroundState | null> {
  state ??= parseBackgroundState(await storage.getItem(BACKGROUND_STATE_KEY));
  return state;
}

async function apiClient() {
  await session.hydrate();
  client ??= makeApiClient(session);
  return client;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const s = await currentState();
  const fixes = data.locations.map((l) => fixFrom(l.coords, l.timestamp, l.mocked));
  const now = Date.now();
  const plan = planBackgroundWake({ state: s, appActive: AppState.currentState === 'active', lastBeatAt, now });
  if (!s || (!plan.heartbeat && !plan.reportPositions)) return;
  const api = await apiClient();
  const latest = fixes[fixes.length - 1];

  if (plan.heartbeat && latest) {
    lastBeatAt = now;
    // Same call as the on-screen heartbeat: idempotent, keeps his zone's anti-camping clock.
    await api.partner.goOnline.mutate({ at: { lat: latest.lat, lng: latest.lng }, ...(s.vehicleClass ? { vehicleClass: s.vehicleClass } : {}) }).catch(() => undefined);
  }

  if (plan.reportPositions) {
    for (const fix of fixes) {
      if (!worthSending(fix)) continue;
      buffer.push(toDeviceFix(fix, prev));
      prev = fix;
    }
    if (sending || buffer.size === 0) return;
    sending = true;
    const batch = buffer.peek(POSITION_RULES.batchMax);
    try {
      await api.trips.reportPositions.mutate({ fixes: batch });
      buffer.drop(batch.length);
    } catch (err) {
      // Refused by the server: resending fails the same way. No answer: keep it for the next wake.
      if (apiErrorCode(err) !== null) buffer.drop(batch.length);
    } finally {
      sending = false;
    }
  }
});

// Signed out: no shift, so no service (and no notification) left running.
session.onSignOut(() => void syncBackgroundLocation({ online: false, onJob: false, vehicleClass: null }));

let disclosureShown = false;

/** Google Play's prominent disclosure: say why, before the OS asks for "allow all the time". */
function disclose(copy: BackgroundCopy): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(copy.disclosureTitle, copy.disclosureBody, [
      { text: copy.disclosureLater, style: 'cancel', onPress: () => resolve(false) },
      { text: copy.disclosureAllow, onPress: () => resolve(true) },
    ], { cancelable: false });
  });
}

/** Background permission, asked once per app run after the disclosure. False: on-screen updates only. */
async function ensureBackgroundPermission(copy: BackgroundCopy): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status === 'granted') return true;
  if (disclosureShown || !bg.canAskAgain) return false;
  disclosureShown = true;
  if (!(await disclose(copy))) return false;
  return (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
}

/**
 * Starts or stops the OS location service for this shift state. Returns whether background tracking
 * is running (false when he declined: the app keeps working while it is open, as before).
 */
export async function syncBackgroundLocation(next: BackgroundState, copy?: BackgroundCopy): Promise<boolean> {
  state = next;
  await storage.setItem(BACKGROUND_STATE_KEY, JSON.stringify(next)).catch(() => undefined);
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (!wantsBackgroundTracking(next)) {
      if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      lastBeatAt = 0;
      prev = null;
      return false;
    }
    if (!copy || !(await ensureBackgroundPermission(copy))) return false;
    if (running) return true;
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: BACKGROUND_INTERVAL_MS,
      distanceInterval: BACKGROUND_DISTANCE_M,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: copy.notificationTitle, notificationBody: copy.notificationBody, killServiceOnDestroy: false },
    });
    return true;
  } catch {
    // Location services off or the OS refused: the on-screen heartbeat still works.
    return false;
  }
}
