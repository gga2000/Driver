import * as Location from 'expo-location';
import type { Fix } from './location';

export { FALLBACK_FIX, type Fix } from './location';

/**
 * Native position through expo-location (foreground permission, asked the first time the driver
 * goes online). Background tracking during a shift is a later step (TODO(background-location):
 * a TaskManager task reporting `trips.reportPosition` while the app is backgrounded).
 */
export async function currentFix(timeoutMs = 6000): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}
