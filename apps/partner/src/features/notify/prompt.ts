import type { PushPermission } from '@/lib/push';

/**
 * When to ask a partner for notifications: on the work home, the first time he is there signed in
 * as a partner — job offers that ring with the app closed are the point of the app. Our own pre-prompt
 * first ("لا يفوتك طلب"), the OS prompt only after "إي"; "بعدين" snoozes a day (work, not marketing).
 */
export const PREPROMPT_KEY = 'driver.partner.push-preprompt';
export const PREPROMPT_SNOOZE_MS = 86_400_000;
export const DEEP_LINK_SCHEME = 'driver-partner';

export function shouldShowPrePrompt(permission: PushPermission, lastDismissedAt: number | null, now: number): boolean {
  if (permission !== 'undetermined') return false;
  return lastDismissedAt === null || now - lastDismissedAt >= PREPROMPT_SNOOZE_MS;
}

/** `driver-partner://offer` → `/offer` (our own scheme, plus the staff safety alerts below). */
export function deepLinkPath(link: unknown, scheme = DEEP_LINK_SCHEME): string | null {
  const staff = staffAlertPath(link);
  if (staff) return staff;
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3);
  return `/${rest}`.replace(/\/+$/, '') || '/';
}

/** A job-offer push (food today; a ride offer push will open the same `/offer` screen). */
export function isOfferPush(data: { template?: unknown; deepLink?: unknown }): boolean {
  return data.template === 'partner_new_job' || deepLinkPath(data.deepLink) === '/offer';
}

/**
 * Staff safety alerts (SOS, the خطوط sweep, the Console watching itself) are sent to staff on any app
 * as `driver://safety[/{incidentId}]`. They are answered in the Console, so the tap opens the
 * staff-alert screen, which opens the alert there.
 */
export function staffAlertPath(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  const m = /^driver:\/\/safety(?:\/([^/?#]+))?\/?$/.exec(link);
  if (!m) return null;
  return m[1] ? `/staff-alert?incident=${encodeURIComponent(m[1])}` : '/staff-alert';
}

/**
 * The Console page for a staff alert: the incident when there is one, else the safety desk. `null` when
 * this build has no Console address (the screen then shows no link).
 */
export function consoleAlertUrl(base: string | null | undefined, incident: string | null | undefined): string | null {
  const root = (base ?? '').trim().replace(/\/+$/, '');
  if (!root) return null;
  return incident ? `${root}/safety/${encodeURIComponent(incident)}` : `${root}/safety`;
}
