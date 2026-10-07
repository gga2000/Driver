import { DEV_TOOLS } from '@/lib/env';
import { minutesRange } from './eta-range';

/**
 * OPEN QUESTION FOR ALI (joy J5b, the tracking ETA box): show the arrival as a range of minutes
 * («12–18 دقيقة») instead of one clock time («يوصلك 7:05»). Built and switched off until he decides;
 * the box keeps showing one time. A dev-tools web build can preview it with `?etaRange=1` (the
 * comparison screenshot), never a store build.
 */
export const ETA_BOX_SHOWS_RANGE = false;

/** The ETA box's range preview from the URL (dev-tools web builds only). */
function previewParam(): boolean {
  if (!DEV_TOOLS || typeof window === 'undefined' || !window.location?.search) return false;
  try {
    return new URLSearchParams(window.location.search).get('etaRange') === '1';
  } catch {
    // A malformed query string previews nothing.
    return false;
  }
}

/** Whether the ETA box shows a range: Ali's switch, or the dev preview. Read once per app start. */
export const etaBoxShowsRange: boolean = ETA_BOX_SHOWS_RANGE || previewParam();

export type EtaBoxContent = { kind: 'time'; minutes: number } | { kind: 'range'; minutes: number; low: number; high: number };

/**
 * What the ETA box says. One clock time by default (the minutes go on the line under it); with the
 * range option, the same honest spread the map pill uses for a straight-line estimate (−20 % / +25 %,
 * at least 2 minutes wide), whether or not the ETA was routed on roads — a range is the option being
 * asked about.
 */
export function etaBoxContent(i: { eta: Date; now: number; showRange: boolean }): EtaBoxContent {
  const minutes = Math.max(1, Math.round((i.eta.getTime() - i.now) / 60_000));
  if (!i.showRange) return { kind: 'time', minutes };
  const r = minutesRange(minutes, 'estimated');
  return { kind: 'range', minutes, low: r.low, high: r.high };
}
