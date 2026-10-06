import type { IntercitySeatId, PinAlertView, PinAttemptView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatClock } from './format';
import { ageText } from './safety';

/**
 * الرجعة seat-PIN alerts on the Console safety strip (Ali 2026-10-06: the PIN stays on the rider's
 * lock screen, so ops see who typed whose PIN on which seat). Pure helpers for the rows under the SOS
 * banner, next to the خطوط sweep rows: a rider's PIN typed on another rider's seat (refused), or
 * `PIN_ATTEMPT_RULES.wrongOnSeatAlertAt` refused PINs on one seat. Seats and times only; the PIN
 * itself never reaches the Console.
 */

/** "قدام" / "ورا يسار، ورا نص" — a booking can hold several seats. */
export function seatsText(seats: readonly IntercitySeatId[]): string {
  return seats.map((s) => t(`seat.${s}`)).join('، ');
}

export function pinDriverName(a: Pick<PinAlertView, 'driver'>): string {
  return a.driver.displayName ?? t('console.safety.role_driver');
}

/**
 * Line 1: "حيدر ك. كتب رمز راكب «ورا يسار» على مقعد «قدام»" (cross-use) or "حيدر ك. كتب رمز غلط
 * 3 مرات على مقعد «قدام»" (repeated wrong PINs; on the plain PIN pad: without a seat).
 */
export function pinAlertTitle(a: PinAlertView): string {
  const name = pinDriverName(a);
  if (a.kind === 'cross_use') return t('console.safety.pin_cross_title', { name, matched: seatsText(a.matchedSeatIds), target: seatsText(a.targetSeatIds) });
  return a.targetSeatIds.length > 0
    ? t('console.safety.pin_wrong_title', { name, n: a.refusedOnSeat, target: seatsText(a.targetSeatIds) })
    : t('console.safety.pin_wrong_pad_title', { name, n: a.refusedOnSeat });
}

/** Line 2: the car and when it leaves, what happened to that PIN, how long ago. */
export function pinAlertDetail(a: PinAlertView, now: number): string {
  return [
    t('console.safety.pin_run', { garage: a.garageNameAr, corridor: a.corridorNameAr, time: formatClock(a.departAt) }),
    t('console.safety.pin_refused_note'),
    t('console.safety.sweep_since', { ago: ageText(now - a.raisedAt.getTime()) }),
  ].join(' · ');
}

/** One history line: "8:12 م · على مقعد «قدام» · رمز «ورا يسار»، انرفض". */
export function pinAttemptLine(x: PinAttemptView): string {
  const where = x.targetSeatIds.length > 0 ? t('console.safety.pin_on_seat', { seat: seatsText(x.targetSeatIds) }) : t('console.safety.pin_on_pad');
  const matched = seatsText(x.matchedSeatIds);
  const what =
    x.result === 'checked_in'
      ? t('console.safety.pin_result_checked_in', { seat: matched })
      : x.result === 'other_booking'
        ? t('console.safety.pin_result_other_booking', { seat: matched })
        : x.result === 'not_boardable'
          ? t('console.safety.pin_result_not_boardable', { seat: matched })
          : t('console.safety.pin_result_wrong');
  return [formatClock(x.at), where, what].join(' · ');
}

/** Cross-use rows first (newest first), then the repeated-wrong ones. */
export function pinAlertOrder(rows: readonly PinAlertView[]): PinAlertView[] {
  const rank = (a: PinAlertView) => (a.kind === 'cross_use' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.raisedAt.getTime() - a.raisedAt.getTime());
}
