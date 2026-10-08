import { haversineM, type LatLng } from '@driver/contracts';

/**
 * How a «موقعي هنا» fix is judged before it becomes the door (audit HUNT-04, FLOW-21): a rough or
 * unknown accuracy is never saved as the door, and a fix far from the saved pin asks first, because
 * the person may simply not be at home (and moving the pin forgets the door couriers learned).
 */
export const PLACE_FIX_RULES = { maxAccuracyM: 40, askBeyondM: 150 } as const;

export type HereFixVerdict = { kind: 'rough'; accuracyM: number | null } | { kind: 'far'; distanceM: number } | { kind: 'ok' };

export function judgeHereFix(fix: { pin: LatLng; accuracyM: number | null }, saved: LatLng | null): HereFixVerdict {
  if (fix.accuracyM === null || fix.accuracyM > PLACE_FIX_RULES.maxAccuracyM) return { kind: 'rough', accuracyM: fix.accuracyM };
  if (saved) {
    const distanceM = haversineM(fix.pin, saved);
    if (distanceM > PLACE_FIX_RULES.askBeyondM) return { kind: 'far', distanceM };
  }
  return { kind: 'ok' };
}

/** True when a fix is too rough to put the pin on the door by itself (the editor says so). */
export function isRoughFix(accuracyM: number | null): boolean {
  return accuracyM === null || accuracyM > PLACE_FIX_RULES.maxAccuracyM;
}

export function judgeDistance(a: LatLng, b: LatLng): number {
  return haversineM(a, b);
}

/** "800 متر", "1.2 كم" (Western digits, voice spec). */
export function distanceText(m: number, t: (key: 'place.distance_m' | 'place.distance_km', params: Record<string, string | number>) => string): string {
  return m < 1000 ? t('place.distance_m', { n: Math.round(m / 10) * 10 }) : t('place.distance_km', { n: (m / 1000).toFixed(1) });
}
