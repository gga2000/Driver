import { DISH_PHOTO_RULES, type DishPhotoRow, type KeepDishPhotoResult } from '@driver/contracts';
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
