import { useQuery } from '@tanstack/react-query';
import * as QuickActions from 'expo-quick-actions';
import { useEffect, useMemo, useRef } from 'react';
import { pickActiveOrder } from '@/features/home/queries';
import { lastReorderable } from '@/features/orders/history';
import { useMyPersonId } from '@/features/orders/queries';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { shortcutItems, shortcutsKey } from './shortcuts';

/**
 * Keeps the app icon's long-press shortcuts in step with the person's orders (joy t1): mounted once at
 * the root, it sets the items when they change (`expo-quick-actions` `setItems`). The web build of the
 * package is a no-op, and so is a build without the native module (Expo Go). Renders nothing.
 *
 * It never polls (audit CORE-10): the running order comes from what home and the order screens already
 * loaded, and the history is read once per session (and again when a screen refreshes it).
 */
export function QuickActionsSync(): null {
  const t = useT();
  const signedIn = useSignedIn();
  const api = useApi();
  const active = useQuery({ ...api.orders.mine.queryOptions(), enabled: false, select: pickActiveOrder });
  const history = useQuery({ ...api.orders.history.queryOptions(), enabled: signedIn, staleTime: Infinity });
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
