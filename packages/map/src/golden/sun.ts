import { AZIZIYAH_CENTER } from '../zones.js';

/** Where the sun stands: azimuth clockwise from north, altitude above the horizon, both in degrees. */
export interface SunPosition {
  az: number;
  alt: number;
}

/** The five lights of the Golden hour map, picked from where the sun is over Aziziyah. */
export type GoldenLight = 'day' | 'morning' | 'golden' | 'sunset' | 'night';

/**
 * The sun over a place at a moment (simplified NOAA, good to about a degree — plenty for a palette
 * and a shadow direction). Defaults to the centre of Aziziyah.
 */
export function sunAt(date: Date, lat = AZIZIYAH_CENTER[1], lng = AZIZIYAH_CENTER[0]): SunPosition {
  const rad = Math.PI / 180;
  const d = (date.getTime() - 946728000000) / 86400000; // days since J2000
  const meanLong = (280.46 + 0.9856474 * d) % 360;
  const anomaly = ((357.528 + 0.9856003 * d) % 360) * rad;
  const lambda = (meanLong + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const eps = (23.439 - 0.0000004 * d) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const hourAngle = (gmst + lng) * rad - ra;
  const la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(hourAngle));
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / rad + 180;
  return { az: (az + 360) % 360, alt: alt / rad };
}

/** High sun → day; low sun → morning (east) or golden (west); just under the horizon → sunset; else night. */
export function lightFor(sun: SunPosition): GoldenLight {
  if (sun.alt >= 20) return 'day';
  if (sun.alt >= 4) return sun.az < 180 ? 'morning' : 'golden';
  if (sun.alt > -5) return 'sunset';
  return 'night';
}

/** A typical sun for each light, used when a screen pins a light instead of following the clock. */
export const TYPICAL_SUN: Record<GoldenLight, SunPosition> = {
  day: { az: 200, alt: 55 },
  morning: { az: 105, alt: 14 },
  golden: { az: 250, alt: 14 },
  sunset: { az: 265, alt: 3 },
  night: { az: 0, alt: -20 },
};
