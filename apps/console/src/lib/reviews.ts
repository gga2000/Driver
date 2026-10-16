import type { IntercityDirection, ReviewHideReason, ReviewOpsView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/** Console «كلام الركاب» (x14): the filter, the reasons and how a review's trip reads. */

export type ReviewFilter = 'all' | 'shown' | 'hidden';

/** The `routes.ops.reviews` input for a filter (undefined = both). */
export function hiddenParam(f: ReviewFilter): boolean | undefined {
  return f === 'all' ? undefined : f === 'hidden';
}

export const HIDE_REASONS: readonly ReviewHideReason[] = ['rude', 'personal_info', 'not_about_trip', 'untrue'];

export const HIDE_REASON_KEY: Record<ReviewHideReason, MessageKey> = {
  rude: 'console.reviews.reason_rude',
  personal_info: 'console.reviews.reason_personal_info',
  not_about_trip: 'console.reviews.reason_not_about_trip',
  untrue: 'console.reviews.reason_untrue',
};

/** «العزيزية ← بغداد» from the corridor's far city and the direction. */
export function tripKey(corridorId: string, direction: IntercityDirection): { from: MessageKey; to: MessageKey } {
  const far: MessageKey = corridorId.endsWith('_kut') ? 'rajaa.city_kut' : 'rajaa.city_baghdad';
  const home: MessageKey = 'rajaa.city_aziziyah';
  return direction === 'to_aziziyah' ? { from: far, to: home } : { from: home, to: far };
}

/** Low stars first draw the eye: a 1–2★ line is the likeliest to need hiding. */
export function starsTone(stars: number): 'bad' | 'warn' | 'neutral' {
  return stars <= 2 ? 'bad' : stars === 3 ? 'warn' : 'neutral';
}

/** The next page starts before the oldest row shown. */
export function nextBefore(rows: readonly ReviewOpsView[]): Date | null {
  return rows.length ? rows[rows.length - 1]!.at : null;
}
