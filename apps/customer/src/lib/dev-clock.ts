import { DEV_TOOLS } from './env';

/**
 * A development-only clock shift for the time-aware home (joy h1): screenshots of dawn, lunch and
 * night come from one demo API by opening the web build with `?now=07:30` (Baghdad wall clock today)
 * or `?now=2026-10-09T13:00:00+03:00`. Off unless dev tools are on (`DEV_TOOLS`), so a store build
 * always reads the real clock. Only what the app shows by the hour moves; the server keeps its time.
 */

/** Baghdad is UTC+3 all year. */
const BAGHDAD_MS = 180 * 60_000;

/** The instant a `?now=` value asks for, or null when it is missing or unreadable. */
export function parseDevNow(value: string | null | undefined, real: Date): Date | null {
  if (!value) return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return null;
    // Today's Baghdad date at that wall-clock time.
    const local = new Date(real.getTime() + BAGHDAD_MS);
    const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - BAGHDAD_MS;
    return new Date(target);
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function readParam(): string | null {
  if (!DEV_TOOLS || typeof window === 'undefined' || !window.location?.search) return null;
  try {
    return new URLSearchParams(window.location.search).get('now');
  } catch {
    // A malformed query string is no clock shift.
    return null;
  }
}

/** Fixed when the app starts: the shift between the asked-for time and the real one. */
const shiftMs: number = (() => {
  const real = new Date();
  const target = parseDevNow(readParam(), real);
  return target ? target.getTime() - real.getTime() : 0;
})();

/** "Now" for time-of-day screens: the real clock, shifted only in a dev build that asked for it. */
export function appNow(realMs: number = Date.now()): Date {
  return new Date(realMs + shiftMs);
}
