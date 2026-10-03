import type { LatLngLike } from './logic';

/**
 * Native position for الرجعة. React Native 0.76 ships no geolocation of its own; when a polyfill
 * (or, later, expo-location) installs `navigator.geolocation` we use it, otherwise both calls
 * resolve null and the screens fall back (default direction; "turn on location" for أني بالكراج).
 * TODO(location): switch to expo-location's getLastKnownPositionAsync once it is a dependency.
 */

type Geo = {
  getCurrentPosition: (
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    fail: () => void,
    opts?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ) => void;
};

function geo(): Geo | null {
  const nav = (globalThis as { navigator?: { geolocation?: Geo } }).navigator;
  return nav?.geolocation ?? null;
}

function read(opts: { enableHighAccuracy: boolean; timeout: number; maximumAge: number }): Promise<LatLngLike | null> {
  const g = geo();
  if (!g) return Promise.resolve(null);
  return new Promise((resolve) => {
    g.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      opts,
    );
  });
}

/** A cached fix is enough to suggest a direction (no waiting on GPS). */
export function lastKnownLocation(): Promise<LatLngLike | null> {
  return read({ enableHighAccuracy: false, timeout: 3000, maximumAge: 6 * 3600_000 });
}

export function currentLocation(timeoutMs = 8000): Promise<LatLngLike | null> {
  return read({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 });
}
