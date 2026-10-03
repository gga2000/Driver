import type { LatLngLike } from './logic';

/**
 * Position for الرجعة (web build). Two uses with different rules:
 *  - `lastKnownLocation()` feeds the direction auto-suggest. On web it is always null so the board
 *    opens on the default (بغداد ← العزيزية) without a permission prompt.
 *  - `currentLocation()` answers an explicit tap ("أني بالكراج"), so asking the browser is fine.
 * The native twin (`location.native.ts`) uses the platform geolocation when present.
 */

export async function lastKnownLocation(): Promise<LatLngLike | null> {
  return null;
}

export function currentLocation(timeoutMs = 8000): Promise<LatLngLike | null> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
