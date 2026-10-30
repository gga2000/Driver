import type { KhatSweepAlert, SafetyIncidentSummary } from '@driver/contracts';
import { t } from '@driver/i18n';
import { personName, roleText } from './safety';
import { sweepDetail, sweepTitle } from './sweep';

/**
 * The alarm that reaches a staff member away from the Console tab: an SOS nobody took, or a خطوط
 * "car is empty" nobody confirmed, becomes a desktop notification (lib/alert-system.ts). This part
 * turns the open rows into those alerts; it runs with the banner, the browser part loads after the page.
 */

export type SystemAlert = { id: string; title: string; body: string; href: string };

/** Open SOS alerts (nobody took them yet). */
export function sosSystemAlerts(rows: readonly SafetyIncidentSummary[]): SystemAlert[] {
  return rows
    .filter((r) => r.state === 'open')
    .map((r) => ({
      id: `sos:${r.id}`,
      title: t('console.alarm.sos_title'),
      body: t('console.alarm.sos_body', { name: personName(r.raiser), role: roleText(r.raiser.role), what: r.subject.label }),
      href: `/safety/${encodeURIComponent(r.id)}`,
    }));
}

/** Open sweep alerts (not confirmed by the driver, not closed by a dispatcher). */
export function sweepSystemAlerts(rows: readonly KhatSweepAlert[], now: number): SystemAlert[] {
  return rows
    .filter((a) => !a.confirmedAt && !a.closedAt)
    .map((a) => ({ id: `sweep:${a.alertId}`, title: sweepTitle(a), body: sweepDetail(a, now), href: '/safety' }));
}
