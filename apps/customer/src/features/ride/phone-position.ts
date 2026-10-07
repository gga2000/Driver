import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { LatLng } from '@driver/contracts';

/**
 * Where the phone is, only when he already allowed location (ride idea n9): a card never asks for
 * the permission itself. The last known fix when the platform has one, else one quick balanced fix
 * (no prompt: the permission is already granted). Null without permission, without a fix in time, or
 * where the platform cannot say (expo-location on the web reads the browser's permission state).
 */
export async function grantedPosition(timeoutMs = 5000): Promise<LatLng | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS });
    const fix =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]));
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

/** A fix this old still places him in a city (he does not leave Baghdad in half an hour). */
const POSITION_MAX_AGE_MS = 30 * 60_000;
/** Looked at again this often while a card that needs it shows. */
const POSITION_REFRESH_MS = 5 * 60_000;

/** The granted position as a query (shared by every card that needs it, refreshed every 5 min). */
export function useGrantedPosition(enabled = true) {
  return useQuery({
    queryKey: ['phone', 'granted-position'],
    queryFn: () => grantedPosition(),
    enabled,
    staleTime: POSITION_REFRESH_MS,
    refetchInterval: POSITION_REFRESH_MS,
    retry: false,
  });
}
