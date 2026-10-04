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
import { useBoard, useHeartbeat, useLiveMerchantBoard } from '@/features/board/queries';
import { usePrinterSync } from '@/features/print/runtime';

/**
 * App-wide kitchen services for the selected store, mounted once under the navigator: the 30-s
 * heartbeat, the live channel (`live.merchantBoard`: rings on a new order at once), the board that drives the new-order alarm (it rings on every screen, not only on
 * the board), and printer status reporting. Off the board, a floating "طلب جديد!" pill leads back.
 */
export function MerchantRuntime({ storeId, onBoard, bottomBar }: { storeId: string; onBoard: boolean; /** Phone tab bar showing: the pill sits above it. */ bottomBar: boolean }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const { wide } = useLayout();
  useHeartbeat(storeId);
  usePrinterSync(storeId);
  // The store's live channel: a new order rings the moment the server offers it to the kitchen.
  useLiveMerchantBoard(storeId, (orderId) => alarm.ringNow(orderId, prefs.soundOn));
  const board = useBoard(storeId);
  const offset = board.offset;
  const clock = useCallback(() => Date.now() + offset, [offset]);
  // The alarm ladder runs here, so it rings (and escalates) on every screen, not only the board.
  const plan = useNewOrderAlarm(board.data?.orders, prefs.soundOn, clock);
  const pending = [...plan.ringing, ...plan.snoozed];
  // A tablet on the counter must never sleep through an order (native; the web asks on "ابدأ الشغل").
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void requestWakeLock();
    return () => releaseWakeLock();
  }, []);

  if (onBoard || pending.length === 0) return null;
  const hot = plan.stage === 'urgent' || plan.stage === 'final';
  return (
    <View
      pointerEvents="box-none"
      // Tablet: top centre, over the page header's empty middle. Phone: above the tab bar, where the thumb is.
      style={[{ position: 'absolute', start: 0, end: 0, alignItems: 'center' }, wide ? { top: insets.top + theme.space[3] } : { bottom: (bottomBar ? 84 : theme.space[4]) + insets.bottom }]}
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
        <Icon name="bell" size={20} color={hot ? 'onDanger' : 'onAccent'} strokeWidth={2.2} />
        <Text weight={700} style={{ fontSize: 17, lineHeight: 26, color: hot ? theme.colors.onDanger : theme.colors.onAccent }}>
          {pending.length > 1 ? t('merchant.board.alert_count', { count: pending.length }) : t('merchant.board.alert_new')}
        </Text>
        <Icon name="chevron-forward" size={18} color={hot ? 'onDanger' : 'onAccent'} />
      </Pressable>
    </View>
  );
}
