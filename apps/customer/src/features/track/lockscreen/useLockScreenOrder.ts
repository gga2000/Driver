import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveOrder } from '@/features/home/queries';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';
import { liveEta } from '../eta';
import { useCourierPosition, useTracking } from '../queries';
import { liveNoticeCard, liveNoticeId, liveNoticeKey } from './content';
import { liveNotice, type LiveNoticeLabels } from './ongoing';

/** The lock-screen card re-reads its clock this often (ETA in the past drops out, words refresh). */
const TICK_MS = 30_000;

/**
 * Keeps the live order or ride on the Android lock screen (joy l1; a no-op on the web and iOS).
 * Mounted once at the root: it follows the person's newest live order (`orders.mine`, polled while
 * one is live), reads its live view (`orders.track` + the courier's ETA), posts the card and replaces
 * it as the order moves, ends with one dismissible «وصل طلبك · قيّم حيدر» for an order this session
 * watched live, and removes it when the order is cancelled. An order push arriving while the JS runs
 * re-reads at once. With the app killed the card keeps its last words until the app runs again (a
 * headless task needs `expo-task-manager`; follow-up, as for the الرجعة pass).
 */
export function useLockScreenOrder() {
  const signedIn = useSignedIn();
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const enabled = liveNotice.supported && signedIn;
  const active = useActiveOrder();
  // The order being followed: the live one, kept after it leaves "active" until its end card is up.
  const [followed, setFollowed] = useState<string | null>(null);
  const liveId = enabled ? (active.data?.id ?? null) : null;
  useEffect(() => {
    if (liveId && liveId !== followed) setFollowed(liveId);
  }, [liveId, followed]);
  const orderId = enabled ? (followed ?? '') : '';
  const track = useTracking(orderId);
  const v = orderId ? track.data : undefined;
  const pos = useCourierPosition(orderId, Boolean(v?.courier));
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || !orderId) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [enabled, orderId]);
  const posted = useRef<{ id: string; key: string } | null>(null);
  // The end card only follows an order this session saw live (never on a cold start hours later).
  const watched = useRef(new Set<string>());
  const labels = useMemo<LiveNoticeLabels>(() => ({ channel: t('live_notice.channel'), channelDesc: t('live_notice.channel_desc') }), [t]);

  useEffect(() => {
    if (!enabled) return;
    const drop = () => {
      if (posted.current) void liveNotice.dismiss(posted.current.id);
      posted.current = null;
    };
    if (!v) {
      if (!orderId) drop();
      return;
    }
    const now = tick + (v.serverNow.getTime() - track.dataUpdatedAt);
    const fix = pos.data ?? null;
    const eta = fix?.etaAt ?? liveEta(v, fix?.pin ?? null, new Date(now));
    const card = liveNoticeCard(v, { eta, now, t, amount: amountParam });
    if (!card || (!card.sticky && !watched.current.has(v.order.id))) {
      drop();
      setFollowed(null);
      return;
    }
    if (card.sticky) watched.current.add(v.order.id);
    const key = liveNoticeKey(card);
    if (posted.current?.key !== key) {
      if (posted.current && posted.current.id !== card.id) void liveNotice.dismiss(posted.current.id);
      void liveNotice.show(card, labels);
      posted.current = { id: card.id, key };
    }
    // The end card is shown once; the order is no longer followed (a swipe removes it for good).
    if (!card.sticky) {
      watched.current.delete(v.order.id);
      posted.current = null;
      setFollowed(null);
    }
  }, [enabled, v, orderId, pos.data, tick, track.dataUpdatedAt, t, labels]);

  // A status push (accepted, picked up, at the door…): read again now instead of at the next poll.
  useEffect(() => {
    if (!enabled) return;
    return liveNotice.onOrderPush(() => {
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      void qc.invalidateQueries({ queryKey: api.orders.track.pathKey() });
    });
  }, [enabled, qc, api]);

  return { orderId: orderId || null, notificationId: orderId ? liveNoticeId(orderId) : null };
}

/** Root mount point; renders nothing. Mounted only where the device supports the card (Android). */
export function LockScreenOrder(): null {
  useLockScreenOrder();
  return null;
}

/** Whether to mount `LockScreenOrder` at all (no polling on the web or iOS). */
export const lockScreenOrderSupported = liveNotice.supported;
