import type { MessageKey } from '@driver/i18n';

/**
 * Long-press the app icon (joy t1, research F3): up to three shortcuts, in the order that helps most
 * right now — «وين طلبي؟» only while an order or ride is live, «اطلب نفس الطلب» when there is a last
 * meal to reorder, «احجز الرجعة» always. Guests get الرجعة only (the others need his orders). Each item
 * carries the route it opens (`params.href`, handled by expo-quick-actions' router hook). Pure.
 */

export type ShortcutId = 'track' | 'reorder' | 'rajaa';

export interface ShortcutItem {
  id: ShortcutId;
  title: string;
  subtitle: string | null;
  /** SF Symbol on iOS; Android shows the app icon until the brand symbol exists (f20). */
  icon: string;
  params: { href: string };
}

/** The home screen starts the reorder sheet for the last meal when opened with this query. */
export const REORDER_LAST_PARAM = 'last';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export function shortcutItems(i: { signedIn: boolean; activeOrderId: string | null; activeIsRide: boolean; lastMerchant: string | null }, t: T): ShortcutItem[] {
  const out: ShortcutItem[] = [];
  if (i.signedIn && i.activeOrderId) {
    out.push({ id: 'track', title: t(i.activeIsRide ? 'shortcut.track_ride' : 'shortcut.track'), subtitle: null, icon: 'symbol:location.fill', params: { href: `/order/${i.activeOrderId}` } });
  }
  if (i.signedIn && i.lastMerchant) {
    out.push({ id: 'reorder', title: t('shortcut.reorder'), subtitle: i.lastMerchant, icon: 'symbol:arrow.clockwise', params: { href: `/?reorder=${REORDER_LAST_PARAM}` } });
  }
  out.push({ id: 'rajaa', title: t('shortcut.rajaa'), subtitle: t('shortcut.rajaa_sub'), icon: 'symbol:bus.fill', params: { href: '/rajaa' } });
  return out;
}

/** Same key → the same items on the icon: don't call the native side again. */
export function shortcutsKey(items: readonly ShortcutItem[]): string {
  return items.map((s) => `${s.id}:${s.title}:${s.subtitle ?? ''}:${s.params.href}`).join('|');
}
