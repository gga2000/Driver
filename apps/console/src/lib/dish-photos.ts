import { DISH_PHOTO_RULES, type DishPhotoRow, type DishPhotoTakedownReason, type KeepDishPhotoResult, type TakeDownDishPhotoResult } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * The Console's read of the p4 same-day look at shop dish photos: which rows are late, and what the
 * toast says after «تمام». Kept pure for the tests.
 */

const HOUR = 3_600_000;

/** Up longer than the same-day mark (`DISH_PHOTO_RULES.lateAfterHours`): the tile turns warm. */
export function isLate(row: Pick<DishPhotoRow, 'pendingSince'>, now: Date): boolean {
  return now.getTime() - row.pendingSince.getTime() >= DISH_PHOTO_RULES.lateAfterHours * HOUR;
}

/** «تمام»'s answer → the toast line and its tone (a newer photo is worth a second look, not an error). */
export const KEEP_TOAST: Record<KeepDishPhotoResult['outcome'], { key: MessageKey; tone: 'ok' | 'default' }> = {
  kept: { key: 'console.dp_kept', tone: 'ok' },
  changed: { key: 'console.dp_changed', tone: 'default' },
  gone: { key: 'console.dp_gone', tone: 'default' },
};

/** «انزّلها»'s answer → the toast line (a newer photo since or someone else's look is not an error). */
export const TAKEDOWN_TOAST: Record<TakeDownDishPhotoResult['outcome'], { key: MessageKey; tone: 'ok' | 'default' }> = {
  taken_down: { key: 'console.dp_taken_down', tone: 'ok' },
  changed: { key: 'console.dp_changed', tone: 'default' },
  gone: { key: 'console.dp_gone', tone: 'default' },
};

/** The reason choices, in the order the dialog shows them. */
export const TAKEDOWN_REASON_KEY: Record<DishPhotoTakedownReason, MessageKey> = {
  blurry: 'console.dp_reason_blurry',
  wrong_dish: 'console.dp_reason_wrong_dish',
  people: 'console.dp_reason_people',
  other: 'console.dp_reason_other',
};
