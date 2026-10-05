import * as Location from 'expo-location';
import { fixFrom, MAX_FIX_AGE_MS, type Fix } from './location-fix';

export { DEMO_FIX, lastRealFix, type Fix } from './location-fix';

/**
 * Native position through expo-location (foreground permission, asked the first time the driver goes
 * online), with the fix's own timestamp, accuracy, speed, heading and Android's mock-location flag.
 * Background tracking during a shift is SP1 (TaskManager), see docs/specs/2026-10-05-maps-world-class.md.
 */
export async function currentFix(timeoutMs = 6000): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS });
    if (last) return fixFrom(last.coords, last.timestamp, last.mocked);
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    return fix ? fixFrom(fix.coords, fix.timestamp, fix.mocked) : null;
  } catch {
    // Location services off or the OS refused: no fix is the honest answer (the caller says so).
    return null;
  }
}
