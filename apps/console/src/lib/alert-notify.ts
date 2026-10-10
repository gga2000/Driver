import type { KhatSweepAlert, SafetyIncidentSummary } from '@driver/contracts';
import { t } from '@driver/i18n';
import { personName, roleText } from './safety';
import { sweepDetail, sweepTitle } from './sweep';

/**
 * The alarm that reaches a staff member away from the Console tab: an SOS nobody took, or a خطوط
 * "car is empty" nobody confirmed, becomes a desktop notification that stays until it is clicked
 * (`requireInteraction`), and the tab title flashes while the tab is hidden. One notification per
 * alert per tab; its `tag` is the alert id, so several open tabs show it once.
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

/** The alerts not notified yet in this tab; marks them as seen. */
export function freshAlerts(alerts: readonly SystemAlert[], seen: Set<string>): SystemAlert[] {
  const fresh = alerts.filter((a) => !seen.has(a.id));
  for (const a of fresh) seen.add(a.id);
  return fresh;
}

/** What the tab title shows on this tick of the flash (every other second the warning). */
export function titleFrame(base: string, count: number, tick: number): string {
  return tick % 2 === 0 ? t('console.alarm.title_flash', { count }) : base;
}

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

type NotificationCtor = {
  permission: 'default' | 'granted' | 'denied';
  requestPermission: () => Promise<'default' | 'granted' | 'denied'>;
  new (title: string, options?: NotificationOptions & { requireInteraction?: boolean }): { onclick: ((this: unknown, ev: Event) => unknown) | null; close: () => void };
};

function notificationApi(): NotificationCtor | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return window.Notification as unknown as NotificationCtor;
}

export function notifyPermission(api: NotificationCtor | null = notificationApi()): NotifyPermission {
  return api ? api.permission : 'unsupported';
}

/** Asks once (only while the browser has not been answered); call it from a click. */
export async function askNotifyPermission(api: NotificationCtor | null = notificationApi()): Promise<NotifyPermission> {
  if (!api) return 'unsupported';
  if (api.permission !== 'default') return api.permission;
  try {
    return await api.requestPermission();
  } catch {
    return api.permission;
  }
}

/** Shows the alert as a desktop notification that stays until clicked; the click opens the alert here. */
export function showSystemAlert(a: SystemAlert, open: (href: string) => void, api: NotificationCtor | null = notificationApi()): boolean {
  if (!api || api.permission !== 'granted') return false;
  try {
    const n = new api(a.title, { body: a.body, tag: a.id, requireInteraction: true, lang: 'ar', dir: 'rtl' });
    n.onclick = () => {
      if (typeof window !== 'undefined') window.focus();
      open(a.href);
      n.close();
    };
    return true;
  } catch {
    // Some browsers (Android Chrome) only allow notifications from a service worker: the tab alarm still rings.
    return false;
  }
}
