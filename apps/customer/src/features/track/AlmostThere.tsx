import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { LatLng, OrderTracking } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Icon, IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { playCue } from '@/lib/sound';
import { cashAtDoor } from './arrival-logic';
import { isNear, momentsBetween, type Moment, type MomentSnapshot } from './moments';
import type { Phase } from './timeline';

/** The delivered moment's buzz comes from the arrival screen itself; the others buzz here. */
const HAPTIC: Record<Moment, 'success' | 'medium' | 'light' | null> = { accepted: 'light', picked_up: 'medium', near: 'success', delivered: null };

/**
 * The tracking screen's moments (maps program SP5b): compares each read of the order with the last
 * one and, for every new moment, buzzes and plays its soft cue. Returns whether the "almost there"
 * card should show: from the first read with him close (latched, so GPS jitter at the line does not
 * blink it) until he arrives or the customer closes it.
 */
export function useTrackingMoments(v: OrderTracking | undefined, phase: Phase | null, courier: LatLng | null): { near: boolean; closeNear: () => void } {
  const theme = useTheme();
  const prev = useRef<MomentSnapshot | null>(null);
  const [nearFor, setNearFor] = useState<string | null>(null);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const door = v?.dropoff?.pin ?? null;
  const food = Boolean(v && v.order.type !== 'ride');
  const near = Boolean(v && phase && isNear(phase, courier, door, food));
  const orderId = v?.order.id ?? null;

  useEffect(() => {
    if (!orderId || !phase) return;
    const next: MomentSnapshot = { orderId, phase, near };
    for (const m of momentsBetween(prev.current, next)) {
      const buzz = HAPTIC[m];
      if (buzz) theme.haptic(buzz);
      playCue(m);
    }
    // The card also shows when the screen opens with him already close (the customer tapped the push).
    if (near) setNearFor(orderId);
    prev.current = next;
    // `theme` is stable for the screen's life; re-running on it would replay nothing anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, phase, near]);

  const show = Boolean(orderId && nearFor === orderId && closedFor !== orderId && phase === 'on_the_way');
  return { near: show, closeNear: () => setClosedFor(orderId) };
}

/** "الدليفري قريب" over the map with what to have ready at the door. */
export function AlmostThereCard({ order, top, onClose }: { order: OrderTracking['order']; top: number; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const pay = cashAtDoor(order);
  return (
    <Animated.View
      testID="almost-there"
      accessibilityRole="alert"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(180)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        paddingEnd: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={pay.kind === 'cash' ? 'cash' : 'home'} size={22} color="accentText" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700}>
          {t('track.near_title')}
        </Text>
        <Text variant="footnote" color="textMuted" testID="almost-there-cash">
          {pay.kind === 'cash'
            ? pay.tender
              ? `${t('track.cash_ready', { amount: amountParam(pay.cashIqd) })}\n${t('cashchange.door_tender', { tender: amountParam(pay.tender.tenderIqd), change: amountParam(pay.tender.changeIqd) })}`
              : t('track.cash_ready', { amount: amountParam(pay.cashIqd) })
            : t('track.near_paid')}
        </Text>
      </View>
      <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="almost-there-close" />
    </Animated.View>
  );
}
