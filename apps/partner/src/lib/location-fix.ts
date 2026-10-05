/**
 * What a driver's position fix carries, shared by the web and native location modules (maps program
 * SP4a): its own timestamp and accuracy, so the API can judge it. The app never invents a position;
 * `DEMO_FIX` exists only for the studio's web demo and headless screenshots (see `usePresence`).
 */

export interface Fix {
  lat: number;
  lng: number;
  /** When the device measured it (ms since epoch), not when we asked. */
  at: number;
  accuracyM?: number;
  speedKmh?: number;
  /** Degrees clockwise from north; only while moving. */
  bearing?: number;
  /** Android: produced by a mock-location app. */
  mocked?: boolean;
}

/** Aziziyah centre (شارع 30): the stand-in position for dev/demo web builds only (`DEV_TOOLS`). */
export const DEMO_FIX = { lat: 32.9095, lng: 45.0635 } as const;
/** Below this speed (m/s) the heading is noise. */
export const MOVING_MS = 0.5;
/** A cached fix up to this old is fine: its own timestamp says how old it is. */
export const MAX_FIX_AGE_MS = 30_000;

let lastReal: Fix | null = null;

/** The newest real fix this session has seen (heartbeats re-send it rather than inventing one). */
export function lastRealFix(): Fix | null {
  return lastReal;
}

/** Shared by web and native: speed (m/s → km/h) and heading only when they mean something. */
export function fixFrom(c: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null }, at: number, mocked?: boolean): Fix {
  const moving = c.speed !== null && c.speed >= MOVING_MS;
  const fix: Fix = {
    lat: c.latitude,
    lng: c.longitude,
    at,
    ...(c.accuracy !== null && c.accuracy >= 0 ? { accuracyM: c.accuracy } : {}),
    ...(c.speed !== null && c.speed >= 0 ? { speedKmh: c.speed * 3.6 } : {}),
    ...(moving && c.heading !== null && c.heading >= 0 && c.heading <= 360 ? { bearing: c.heading } : {}),
    ...(mocked ? { mocked: true } : {}),
  };
  lastReal = fix;
  return fix;
}
