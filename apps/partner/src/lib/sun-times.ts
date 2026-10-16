/**
 * Sunrise and sunset for a place and day (NOAA's simplified solar position, good to about a minute),
 * so the driver app turns to its night look at sunset in Aziziyah (idea n2) without a network call.
 */

/** Aziziyah, Wasit. */
export const AZIZIYAH = { lat: 32.909, lng: 45.064 } as const;

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

/** Sunrise and sunset (UTC instants) on the UTC calendar day of `day`; null at polar day or night. */
export function sunTimes(day: Date, lat: number = AZIZIYAH.lat, lng: number = AZIZIYAH.lng): { sunrise: Date; sunset: Date } | null {
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const n = Math.floor((midnight - Date.UTC(day.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
  // Fractional year (radians).
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // Zenith 90.833°: the sun's upper edge on the horizon, with refraction.
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / RAD;
  const noonMin = 720 - 4 * lng - eqTime;
  return {
    sunrise: new Date(midnight + (noonMin - 4 * ha) * 60_000),
    sunset: new Date(midnight + (noonMin + 4 * ha) * 60_000),
  };
}

/**
 * Whether it is dark at `now` in Aziziyah, and when that next changes (the app sets one timer for
 * that moment instead of checking the clock).
 */
export function nightAt(now: Date, lat: number = AZIZIYAH.lat, lng: number = AZIZIYAH.lng): { night: boolean; nextChange: Date } {
  const today = sunTimes(now, lat, lng);
  const tomorrow = sunTimes(new Date(now.getTime() + DAY_MS), lat, lng);
  if (!today || !tomorrow) return { night: false, nextChange: new Date(now.getTime() + DAY_MS) };
  const t = now.getTime();
  if (t < today.sunrise.getTime()) return { night: true, nextChange: today.sunrise };
  if (t < today.sunset.getTime()) return { night: false, nextChange: today.sunset };
  return { night: true, nextChange: tomorrow.sunrise };
}
