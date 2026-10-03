import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { usePrefs } from '@/lib/prefs';
import { useNewOrderAlarm } from '@/features/board/alarm';
import { useBoard, useHeartbeat } from '@/features/board/queries';
import { usePrinterSync } from '@/features/print/runtime';

/**
 * App-wide kitchen services for the selected store, mounted once under the navigator: the 30-s
 * heartbeat, the board poll that drives the new-order alarm (it rings on every screen, not only on
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
  const board = useBoard(storeId);
  const pending = useNewOrderAlarm(board.data?.orders, prefs.soundOn);

  if (onBoard || pending.length === 0) return null;
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
          backgroundColor: theme.colors.accent,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <Icon name="bell" size={20} color="onAccent" strokeWidth={2.2} />
        <Text weight={700} style={{ fontSize: 17, lineHeight: 26, color: theme.colors.onAccent }}>
          {pending.length > 1 ? t('merchant.board.alert_count', { count: pending.length }) : t('merchant.board.alert_new')}
        </Text>
        <Icon name="chevron-forward" size={18} color="onAccent" />
      </Pressable>
    </View>
  );
}
