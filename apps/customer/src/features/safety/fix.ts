import type { SosPosition } from '@driver/contracts';

/**
 * The phone's position for an SOS (web build): the browser's fix with its accuracy and time. Null
 * when the browser has no GPS or says no — the alert still goes out (the API falls back to the
 * trip's last known position). Native: `fix.native.ts` (expo-location).
 */
export function currentSosFix(timeoutMs = 3000): Promise<SosPosition | null> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 300);
    geo.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null, at: new Date(p.timestamp || Date.now()) });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5_000 },
    );
  });
}
