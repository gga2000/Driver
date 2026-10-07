import * as QuickActions from 'expo-quick-actions';
import { useEffect, useMemo, useRef } from 'react';
import { useActiveOrder } from '@/features/home/queries';
import { lastReorderable } from '@/features/orders/history';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { shortcutItems, shortcutsKey } from './shortcuts';

/**
 * Keeps the app icon's long-press shortcuts in step with the person's orders (joy t1): mounted once at
 * the root, it sets the items when they change (`expo-quick-actions` `setItems`). The web build of the
 * package is a no-op, and so is a build without the native module (Expo Go). Renders nothing.
 */
export function QuickActionsSync(): null {
  const t = useT();
  const signedIn = useSignedIn();
  const active = useActiveOrder();
  const history = useOrderHistory();
  const me = useMyPersonId();
  const last = useMemo(() => lastReorderable(history.data ?? [], new Date(), me), [history.data, me]);
  const items = useMemo(
    () => shortcutItems({ signedIn, activeOrderId: active.data?.id ?? null, activeIsRide: active.data?.type === 'ride', lastMerchant: last?.merchantName ?? null }, t),
    [signedIn, active.data, last, t],
  );
  const set = useRef<string | null>(null);
  useEffect(() => {
    const key = shortcutsKey(items);
    if (set.current === key) return;
    set.current = key;
    // A launcher that refuses shortcuts just keeps none; the app works the same without them.
    QuickActions.setItems(items).catch(() => {
      set.current = null;
    });
  }, [items]);
  return null;
}
