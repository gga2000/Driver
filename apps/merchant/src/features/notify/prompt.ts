import type { PushPermission } from '@/lib/push';

/**
 * When to ask the kitchen for notifications: on the orders board, the first time the store is ready
 * — a new order has 90 seconds and must ring with the app closed. Our pre-prompt first, the OS
 * prompt after "إي"; "بعدين" snoozes a day.
 */
export const PREPROMPT_KEY = 'driver.merchant.push-preprompt';
export const PREPROMPT_SNOOZE_MS = 86_400_000;
export const DEEP_LINK_SCHEME = 'driver-merchant';

export function shouldShowPrePrompt(permission: PushPermission, lastDismissedAt: number | null, now: number): boolean {
  if (permission !== 'undetermined') return false;
  return lastDismissedAt === null || now - lastDismissedAt >= PREPROMPT_SNOOZE_MS;
}

/** `driver-merchant://order/ord_1` → `/order/ord_1`; the board has no order route, so orders open the board. */
export function deepLinkPath(link: unknown, scheme = DEEP_LINK_SCHEME): string | null {
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3).replace(/\/+$/, '');
  if (rest === '' || rest.startsWith('order/')) return '/';
  return `/${rest}`;
}
