/**
 * The driver's position (web build). Going online needs a fix; the browser asks once. When the
 * browser refuses or has no GPS (desktop QA, headless screenshots) the caller falls back to the
 * last position the server knows, then to the town centre — the app never blocks on GPS.
 * Native: `location.native.ts` (expo-location).
 */

export interface Fix {
  lat: number;
  lng: number;
}

/** Aziziyah centre (شارع 30): the fallback when no fix is available. */
export const FALLBACK_FIX: Fix = { lat: 32.9095, lng: 45.0635 };

export function currentFix(timeoutMs = 6000): Promise<Fix | null> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    geo.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
