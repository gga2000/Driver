import { westernDigits, type LandmarkNearView } from '@driver/contracts';
import type { AppLocale } from '@/lib/profile';
import type { TFn } from '@/lib/i18n';

/**
 * "قرب شنو؟" (maps program a2), the place editor's landmark chips. Plain functions so they run in
 * Node tests; the step itself is `LandmarkStep` in the place editor.
 */

/** The "ولا وحدة" chip: no landmark. Not a landmark id (those are `lm_…` or place ids). */
export const LANDMARK_NONE = 'none';

/** A landmark's name in the app's language, digits 0–9 (voice guide). */
export function landmarkName(l: Pick<LandmarkNearView, 'name_ar' | 'name_en'>, locale: AppLocale): string {
  return locale === 'en' ? l.name_en : westernDigits(l.name_ar);
}

/** Nearest first as the server sent them («يم الجامع الكبير»), then "ولا وحدة" last. */
export function landmarkChips(near: readonly LandmarkNearView[], locale: AppLocale, t: TFn): Array<{ id: string; label: string; icon: 'map-pin' | 'x' }> {
  return [...near.map((l) => ({ id: l.id, label: t('place.landmark_chip', { name: landmarkName(l, locale) }), icon: 'map-pin' as const })), { id: LANDMARK_NONE, label: t('place.landmark_none'), icon: 'x' as const }];
}

/**
 * The chosen landmark is no longer offered for this pin (the house moved): the editor drops it,
 * since saving it would be refused (`place_landmark_invalid`). Only on a settled answer for the
 * current pin — never on the previous pin's list shown while the new one loads.
 */
export function landmarkLeftBehind(landmarkId: string | null, near: readonly LandmarkNearView[] | undefined, settled: boolean): boolean {
  if (!landmarkId || !settled || !near) return false;
  return !near.some((l) => l.id === landmarkId);
}
