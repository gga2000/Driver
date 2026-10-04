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
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3).replace(/\/+$/, '');
  if (rest === '' || rest.startsWith('order/')) return '/';
  return `/${rest}`;
}
