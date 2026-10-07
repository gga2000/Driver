import { orderTicketNumber, type StartCodeAlert } from '@driver/contracts';
import { t } from '@driver/i18n';
import { ageText } from './safety';

/**
 * s1 «رمز المشوار» (ride step 3) on the Console safety strip: a night ride's 4-digit code typed wrong
 * `START_CODE_RULES.wrongAlertAt` times on one pickup — a driver trying to start a ride without the
 * rider, or the wrong rider getting in. Pure helpers for the row; the code itself never reaches the
 * Console.
 */

export function startCodeDriverName(a: Pick<StartCodeAlert, 'driver'>): string {
  return a.driver.displayName ?? t('console.safety.role_driver');
}

/** Line 1: "حيدر ك. كتب رمز المشوار غلط 5 مرات". */
export function startCodeTitle(a: StartCodeAlert): string {
  return t('console.safety.start_code_title', { name: startCodeDriverName(a), n: a.wrongCount });
}

/** Line 2: the ride, whether the rider got in since, how long ago. */
export function startCodeDetail(a: StartCodeAlert, now: number): string {
  return [
    t('console.safety.start_code_ride', { vehicle: t(a.vertical === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi'), id: orderTicketNumber(a.orderId) }),
    a.startedAt ? t('console.safety.start_code_started') : t('console.safety.start_code_waiting'),
    t('console.safety.sweep_since', { ago: ageText(now - a.raisedAt.getTime()) }),
  ].join(' · ');
}

/** Rides still not started first, newest first within each. */
export function startCodeOrder(rows: readonly StartCodeAlert[]): StartCodeAlert[] {
  return [...rows].sort((x, y) => Number(x.startedAt !== null) - Number(y.startedAt !== null) || y.raisedAt.getTime() - x.raisedAt.getTime());
}
