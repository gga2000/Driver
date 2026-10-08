import { router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { releaseWakeLock, requestWakeLock } from '@/lib/keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { usePrefs } from '@/lib/prefs';
import { alarm, useNewOrderAlarm } from '@/features/board/alarm';
import { AlarmEdge } from '@/features/board/AlarmEdge';
import { holdToasts } from '@/lib/toast';
import { alarmQuiet } from '@/features/board/ladder';
import { useStoreStatus } from '@/features/store/queries';
import { summaryTitle } from '@/features/board/Banners';
import { newOrderSummary } from '@/features/board/logic';
import { useBoard, useHeartbeat, useLiveMerchantBoard, useReadyQueueFlush } from '@/features/board/queries';
import { ALIVE_MS, loadShift, markAlive } from '@/features/board/shift';
import { usePrinterSync } from '@/features/print/runtime';

/**
 * App-wide kitchen services for the selected store, mounted once under the navigator: the 30-s
 * heartbeat, the live channel (`live.merchantBoard`: rings on a new order at once), the board that drives the new-order alarm (it rings on every screen, not only on
 * the board), and printer status reporting. Off the board, "3 طلبات تنتظر" leads back: a floating pill
 * at the top on the tablet, a strip docked above the phone's tab bar (it takes its own room, never
 * covering a screen's content). Rendered between the screens and the tab bar for that reason.
 */
export function MerchantRuntime({ storeId, onBoard, bottomBar }: { storeId: string; onBoard: boolean; /** Phone tab bar showing: the strip sits on it (no safe-area padding of its own). */ bottomBar: boolean }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const { wide } = useLayout();
  useHeartbeat(storeId);
  usePrinterSync(storeId);
  // y6: «صار جاهز» taps kept offline go out as soon as the net is back.
  useReadyQueueFlush(storeId);
  // y3: the shift notes it is alive, so a restart mid-shift knows how long the tablet was off.
  useEffect(() => {
    void loadShift();
    const id = setInterval(() => markAlive(), ALIVE_MS);
    return () => clearInterval(id);
  }, []);
  // The store's live channel: a new order rings the moment the server offers it to the kitchen.
  useLiveMerchantBoard(storeId, (orderId) => alarm.ringNow(orderId, prefs.soundOn));
  const board = useBoard(storeId);
  const offset = board.offset;
  const clock = useCallback(() => Date.now() + offset, [offset]);
  // The alarm ladder runs here, so it rings (and escalates) on every screen, not only the board.
  // m6a: a closed store (by hand, the end-of-day card, or out of hours) never rings.
  const status = useStoreStatus(storeId);
  const plan = useNewOrderAlarm(board.data?.orders, prefs.soundOn, clock, alarmQuiet(status.data));
  const pending = [...plan.ringing, ...plan.snoozed, ...plan.closed];
  // a7: nothing opens over a ringing order — the counter's own toasts wait until it is answered.
  const ringing = plan.ringing.length > 0;
  useEffect(() => holdToasts(ringing), [ringing]);
  // a8: the screen edge flashes on every screen while an order rings past its first 30 s.
  const edge = <AlarmEdge stage={ringing ? plan.stage : null} wide={wide} />;
  // A tablet on the counter must never sleep through an order (native; the web asks on "ابدأ الشغل").
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void requestWakeLock();
    return () => releaseWakeLock();
  }, []);

  if (onBoard || pending.length === 0) return edge;
  const hot = plan.stage === 'final';
  const fg = hot ? theme.colors.onDanger : theme.colors.onAccent;
  const iconColor = hot ? 'onDanger' : 'onAccent';
  // M-10: the same number and words as the board's banner and the جديد column.
  const label = summaryTitle(t, newOrderSummary(board.data?.orders ?? [], plan.snoozed));
  if (!wide) {
    // Phone: a strip docked in the layout right above the tab bar (or the bottom edge) — it takes its own
    // room, so it never covers a screen's last line (the weekly statement's «رصيد آخر الأسبوع»).
    return (
      <>
      {edge}
      <Pressable
        testID="new-order-pill"
        accessibilityRole="button"
        onPress={() => router.navigate('/')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          minHeight: 48,
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[2],
          paddingBottom: theme.space[2] + (bottomBar ? 0 : insets.bottom),
          backgroundColor: hot ? theme.colors.danger : theme.colors.accent,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Icon name="bell" size={20} color={iconColor} strokeWidth={2.2} />
        <Text weight={700} numberOfLines={1} style={{ flex: 1, fontSize: 17, lineHeight: 26, color: fg }}>
          {label}
        </Text>
        <Icon name="chevron-forward" size={18} color={iconColor} />
      </Pressable>
      </>
    );
  }
  return (
    <>
    {edge}
    <View
      pointerEvents="box-none"
      // Tablet: top centre, over the page header's empty middle.
      style={{ position: 'absolute', start: 0, end: 0, alignItems: 'center', top: insets.top + theme.space[3] }}
    >
      <Pressable
        testID="new-order-pill"
        accessibilityRole="button"
        onPress={() => router.navigate('/')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          height: 48,
          paddingHorizontal: theme.space[5],
          borderRadius: theme.radius.pill,
          backgroundColor: hot ? theme.colors.danger : theme.colors.accent,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <Icon name="bell" size={20} color={iconColor} strokeWidth={2.2} />
        <Text weight={700} style={{ fontSize: 17, lineHeight: 26, color: fg }}>
          {label}
        </Text>
        <Icon name="chevron-forward" size={18} color={iconColor} />
      </Pressable>
    </View>
    </>
  );
}
