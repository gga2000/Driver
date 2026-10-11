import { useCallback, useMemo, useState } from 'react';
import type { LatLng } from '@driver/contracts';
import { safeStopFor } from '@driver/map/pieces';
import { useLandmarks } from '@/features/track/map/useLandmarks';
import { DEV_TOOLS } from '@/lib/env';
import type { SafeStop, WalkRoad } from './walk-stop';

/**
 * Dev only (`EXPO_PUBLIC_DEV_TOOLS`): a stop 60 m away for screenshots, with `?walk=demo` on the page
 * or `sessionStorage['driver.dev.walk'] = 'demo'` (the web build loads this screen after the first URL is gone).
 */
function walkDemo(): boolean {
  if (!DEV_TOOLS || typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location?.search ?? '').get('walk') === 'demo' || window.sessionStorage?.getItem('driver.dev.walk') === 'demo';
  } catch {
    return false;
  }
}

/** About 60 m north-east of the pin, facing the nearest landmark (or the big mosque). */
function demoStop(pin: LatLng, landmarks: readonly { name: string; at: [number, number] }[]): SafeStop {
  const stop: [number, number] = [pin.lng + 0.00045, pin.lat + 0.00025];
  const near = [...landmarks].sort((a, b) => Math.hypot(a.at[0] - stop[0], a.at[1] - stop[1]) - Math.hypot(b.at[0] - stop[0], b.at[1] - stop[1]))[0];
  const close = near && Math.hypot(near.at[0] - stop[0], near.at[1] - stop[1]) < 0.0015;
  return { stop, landmarkName: close ? near.name : 'الجامع الكبير', walkM: 60 };
}

/**
 * The safe stop for the pickup pin (map idea N10), from the roads the ride map has drawn
 * (`onRoads`, fired when the map settles) and the city's landmarks. Null when the pin is already on a
 * main road, nothing is near, or the map has no roads (the drawn town, low-data mode).
 */
export function useWalkStop(pin: LatLng | null): { stop: SafeStop | null; onRoads: (roads: WalkRoad[]) => void } {
  const [roads, setRoads] = useState<readonly WalkRoad[]>([]);
  const feed = useLandmarks();
  const landmarks = useMemo(() => feed.map((l) => ({ name: l.name_ar, at: [l.pin.lng, l.pin.lat] as [number, number] })), [feed]);
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  const stop = useMemo(() => {
    if (lat === null || lng === null) return null;
    if (walkDemo()) return demoStop({ lat, lng }, landmarks);
    return roads.length > 0 ? safeStopFor([lng, lat], roads, landmarks) : null;
  }, [lat, lng, roads, landmarks]);
  const onRoads = useCallback((next: WalkRoad[]) => setRoads(next), []);
  return { stop, onRoads };
}
