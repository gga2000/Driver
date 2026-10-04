import type { PushPermission } from '@/lib/push';

/**
 * When to ask for notifications (customer): never on first launch. The first time it matters is
 * right after the first order goes in ("نخبرك لما المطعم يقبل"), so the order screen asks — with our
 * own Iraqi-Arabic pre-prompt first; the OS prompt only follows a "إي". "بعدين" snoozes a week.
 * A denied permission is never re-asked here; settings shows the way to the phone's settings.
 */
export const PREPROMPT_KEY = 'driver.customer.push-preprompt';
export const PREPROMPT_SNOOZE_MS = 7 * 86_400_000;

export function shouldShowPrePrompt(permission: PushPermission, lastDismissedAt: number | null, now: number): boolean {
  if (permission !== 'undetermined') return false;
  return lastDismissedAt === null || now - lastDismissedAt >= PREPROMPT_SNOOZE_MS;
}

/** `driver://order/ord_1` → `/order/ord_1` (only our own scheme; anything else is ignored). */
export function deepLinkPath(link: unknown, scheme = 'driver'): string | null {
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3);
  return `/${rest}`.replace(/\/+$/, '') || '/';
}

/** A tiny signal: the pre-prompt or settings changed the permission, so registration runs again. */
type Listener = () => void;
const listeners = new Set<Listener>();
export const permissionSignal = {
  emit(): void {
    for (const l of listeners) l();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
