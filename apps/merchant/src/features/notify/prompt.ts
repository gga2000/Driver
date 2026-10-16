import type { PushPermission } from '@/lib/push';

/**
 * When to ask the kitchen for notifications (a new order has 90 seconds and must ring with the app
 * closed). UI/UX audit M-03: never as a modal over a ringing board — it is a calm strip on the board
 * when nothing waits and no sheet is open ("خلّي التابلت يرن حتى لو التطبيق مسكّر" · "شغّلها"), and
 * "بعدين" puts it away for a week, not a day (a daily ask became a nag at the start of every shift).
 */
export const PREPROMPT_KEY = 'driver.merchant.push-preprompt';
export const PREPROMPT_SNOOZE_MS = 7 * 86_400_000;
export const DEEP_LINK_SCHEME = 'driver-merchant';

export function shouldShowPrePrompt(permission: PushPermission, lastDismissedAt: number | null, now: number): boolean {
  if (permission !== 'undetermined') return false;
  return lastDismissedAt === null || now - lastDismissedAt >= PREPROMPT_SNOOZE_MS;
}

/** The strip only shows on a calm board: nothing waiting or ringing, no sheet open, shift started. */
export function boardCalmForPrompt(s: { waiting: number; sheetOpen: boolean; shiftStarted: boolean }): boolean {
  return s.waiting === 0 && !s.sheetOpen && s.shiftStarted;
}

/** `driver-merchant://order/ord_1` → `/order/ord_1`; the board has no order route, so orders open the board. */
export function deepLinkPath(link: unknown, scheme = DEEP_LINK_SCHEME): string | null {
  const staff = staffAlertPath(link);
  if (staff) return staff;
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3).replace(/\/+$/, '');
  if (rest === '' || rest.startsWith('order/')) return '/';
  return `/${rest}`;
}

/**
 * MER-05: a new-order push names the store it is for. When that is not the store open on this
 * device (staff working two stores), the tap switches to it first, so the order is on the board.
 */
export function storeFromPush(data: { merchantOrgId?: unknown }, current: string | null): string | null {
  const id = data.merchantOrgId;
  return typeof id === 'string' && id !== '' && id !== current ? id : null;
}

/**
 * MER-12: whether this device can ring for a new order with the app closed. `off` = the kitchen said
 * no to notifications; `failed` = allowed but this install has no push token registered. The browser
 * build has no pushes at all, and «undetermined» belongs to the pre-prompt strip: both are `unknown`.
 */
export type PushHealth = 'ok' | 'off' | 'failed' | 'unknown';

export function pushHealthOf(s: { web: boolean; permission: PushPermission; registered: boolean }): PushHealth {
  if (s.web || s.permission === 'undetermined') return 'unknown';
  if (s.permission === 'denied') return 'off';
  return s.registered ? 'ok' : 'failed';
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
