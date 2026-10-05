/**
 * The driver's position (web build), through the browser's geolocation. Native: `location.native.ts`.
 */
import { fixFrom, MAX_FIX_AGE_MS, type Fix } from './location-fix';

export { DEMO_FIX, lastRealFix, type Fix } from './location-fix';

export function currentFix(timeoutMs = 6000): Promise<Fix | null> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    geo.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve(fixFrom(p.coords, p.timestamp));
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: MAX_FIX_AGE_MS },
    );
  });
}
