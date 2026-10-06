import { orderTicketNumber, type KhatSweepAlert } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatClock } from './format';
import { zoneName } from './labels';
import { ageText } from './safety';

/**
 * خطوط sweep alerts on the Console (partner S-6; Ali 2026-10-06): pure helpers for the strip under the
 * SOS banner. An open alert means a run ended `KHAT_RULES.sweepAlertAfterMin` ago and the driver has
 * not confirmed the car is empty; a cleared one says how late he confirmed.
 */

/** Open alerts first (oldest run first), then the late confirms (latest first); closed ones are gone. */
export function sweepOrder(rows: readonly KhatSweepAlert[]): KhatSweepAlert[] {
  const live = rows.filter((r) => !r.closedAt);
  const open = live.filter((r) => !r.confirmedAt).sort((a, b) => a.runEndedAt.getTime() - b.runEndedAt.getTime());
  const cleared = live.filter((r) => r.confirmedAt).sort((a, b) => b.confirmedAt!.getTime() - a.confirmedAt!.getTime());
  return [...open, ...cleared];
}

export function sweepDriverName(a: KhatSweepAlert): string {
  return a.driver.displayName ?? t('console.safety.role_driver');
}

/** Line 1: "حيدر ك. ما تأكد إن السيارة فاضية" / "حيدر ك. تأكد متأخر 7 دقيقة". */
export function sweepTitle(a: KhatSweepAlert): string {
  const name = sweepDriverName(a);
  return a.confirmedAt ? t('console.safety.sweep_late', { name, n: a.confirmedLateMin ?? 0 }) : t('console.safety.sweep_open', { name });
}

/**
 * Line 2: the run, where and when the last child got out, how long ago (open) or that nothing is
 * left to do (cleared): "خط اليوم #4821 · مركز العزيزية · آخر نزول 7:40 ص · قبل 6 د".
 */
export function sweepDetail(a: KhatSweepAlert, now: number): string {
  const parts = [
    t('console.safety.sweep_run', { ref: orderTicketNumber(a.tripId) }),
    a.lastDropZone ? zoneName(a.lastDropZone) : null,
    a.lastDropAt ? t('console.safety.sweep_last_drop', { time: formatClock(a.lastDropAt) }) : t('console.safety.sweep_ended', { time: formatClock(a.runEndedAt) }),
    a.confirmedAt ? t('console.safety.sweep_cleared_note') : t('console.safety.sweep_since', { ago: ageText(now - a.runEndedAt.getTime()) }),
  ];
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}
