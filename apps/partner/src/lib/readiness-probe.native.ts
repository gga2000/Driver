/**
 * What the readiness row (audit S-8) learns on the phone: location services and permission
 * (expo-location), battery level and charging (expo-battery — a native module, so a development
 * build is needed), push permission (expo-notifications) and the app coming back to the foreground.
 * Same API as readiness-probe.ts. Never prompts by itself — only `askGps()` (the fix button) does.
 */
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { AppState, Linking } from 'react-native';
import type { BatteryState, GpsState, PushState } from '@/features/work/readiness';
import { pushDevice } from './push';

export async function gpsState(): Promise<GpsState> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'off';
    const p = await Location.getForegroundPermissionsAsync();
    if (p.status === 'granted') return 'on';
    return p.status === 'denied' && !p.canAskAgain ? 'off' : 'ask';
  } catch {
    return 'ask';
  }
}

export async function askGps(): Promise<GpsState> {
  try {
    await Location.requestForegroundPermissionsAsync();
  } catch {
    /* the state below says what happened */
  }
  return gpsState();
}

export async function watchBattery(cb: (b: BatteryState) => void): Promise<(() => void) | null> {
  try {
    if (!(await Battery.isAvailableAsync())) return null;
    let level = await Battery.getBatteryLevelAsync();
    let state = await Battery.getBatteryStateAsync();
    const charging = () => state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    // -1 means the OS won't say (simulators): hide the chip rather than show a wrong number.
    if (level < 0) return null;
    cb({ level, charging: charging() });
    const a = Battery.addBatteryLevelListener((e) => {
      level = e.batteryLevel;
      cb({ level, charging: charging() });
    });
    const b = Battery.addBatteryStateListener((e) => {
      state = e.batteryState;
      cb({ level, charging: charging() });
    });
    return () => {
      a.remove();
      b.remove();
    };
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  try {
    return await pushDevice.permission();
  } catch {
    return 'undetermined';
  }
}

export async function openSettings(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}

export function onForeground(cb: () => void): () => void {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') cb();
  });
  return () => sub.remove();
}
