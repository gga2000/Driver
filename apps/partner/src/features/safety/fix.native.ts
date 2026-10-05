import * as Location from 'expo-location';
import type { SosPosition } from '@driver/contracts';

/**
 * The phone's position for an SOS (expo-location): a fresh high-accuracy fix, or the last known one
 * when GPS is slow. Null without permission — the alert still goes out.
 */
export async function currentSosFix(timeoutMs = 3000): Promise<SosPosition | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    const fix = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }));
    if (!fix) return null;
    return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracyM: fix.coords.accuracy != null ? Math.round(fix.coords.accuracy) : null, at: new Date(fix.timestamp) };
  } catch {
    return null;
  }
}
