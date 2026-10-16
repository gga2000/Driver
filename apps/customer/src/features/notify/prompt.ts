import type { Phase } from '@/features/track/timeline';
import type { PushPermission } from '@/lib/push';

/**
 * When to ask for notifications (customer): never on first launch. The first time it matters is
 * right after the first order goes in ("نخبرك أول ما المطعم يقبل؟"), so the kitchen-waiting screen asks
 * (rides: the sheet while we look for a driver) — with our own Iraqi-Arabic card first, never a sheet over
 * the map; the OS prompt only follows a "إي". "لا هسة" snoozes a week.
 * A denied permission is never re-asked here; settings shows the way to the phone's settings.
 */
export const PREPROMPT_KEY = 'driver.customer.push-preprompt';
export const PREPROMPT_SNOOZE_MS = 7 * 86_400_000;

export function shouldShowPrePrompt(permission: PushPermission, lastDismissedAt: number | null, now: number): boolean {
  if (permission !== 'undetermined') return false;
  return lastDismissedAt === null || now - lastDismissedAt >= PREPROMPT_SNOOZE_MS;
}

/**
 * Joy f1 (L-01): the ask never covers the live map. Food asks inline on the kitchen-waiting screen
 * (`app/kitchen/[id].tsx`), the dead time right before the first push matters. A ride has no such
 * screen, so it asks inline in the collapsed sheet from the search on (the wait for a driver is the
 * dead time, and «لگينا سايق» is the first push that matters) until the driver is at the pickup.
 */
export function rideAskOnLiveScreen(ride: boolean, phase: Phase | null): boolean {
  return ride && (phase === 'searching' || phase === 'to_pickup' || phase === 'at_pickup');
}

/** `driver://order/ord_1` → `/order/ord_1` (only our own scheme; anything else is ignored). */
export function deepLinkPath(link: unknown, scheme = 'driver'): string | null {
  if (typeof link !== 'string' || !link.startsWith(`${scheme}://`)) return null;
  const rest = link.slice(scheme.length + 3);
  return `/${rest}`.replace(/\/+$/, '') || '/';
}

/**
 * Where a tapped push goes and how, or null: not one of our links, or that very screen is already the
 * one open (CORE-17: a second copy is never stacked on it; it refreshes itself). The same screen with
 * other details in the link (a chat's kind) is swapped in place, never stacked.
 */
export function pushRoute(link: unknown, currentPath: string | null): { path: string; how: 'push' | 'replace' } | null {
  const path = deepLinkPath(link);
  if (!path) return null;
  const [screen, query] = path.split('?');
  if (screen !== currentPath) return { path, how: 'push' };
  return query ? { path, how: 'replace' } : null;
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
