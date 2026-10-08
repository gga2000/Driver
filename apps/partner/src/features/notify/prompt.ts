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

/** `driver-partner://offer` → `/offer` (only our own scheme). */
export function deepLinkPath(link: unknown, scheme = DEEP_LINK_SCHEME): string | null {
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3);
  return `/${rest}`.replace(/\/+$/, '') || '/';
}

/** A job-offer push (food today; a ride offer push will open the same `/offer` screen). */
export function isOfferPush(data: { template?: unknown; deepLink?: unknown }): boolean {
  return data.template === 'partner_new_job' || deepLinkPath(data.deepLink) === '/offer';
}
