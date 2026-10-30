import { useEffect } from 'react';
import { Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art, Button, Icon, MeshFill, StarPattern, Text, useAnnounce, useMotionPresets, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { syncBackgroundLocation } from '@/lib/background-location';
import { useT } from '@/lib/i18n';

const PLAY_APP = 'market://details?id=iq.driver.partner';
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=iq.driver.partner';

/**
 * CORE-05 «حدّث التطبيق»: the server refuses this build (`update_required`), so the whole app is this
 * page until he restarts on a new one. It needs no network. Offers, the live channel and the job
 * screens are unmounted with the app behind it and the background location service is stopped; the
 * page tells him he can't take offers on this phone until he updates.
 *
 * Saffron dawn, the customer app's look (lane C #104, Ali's concept A): saffron with the khatam star
 * lines and the phone getting its update, then a cream sheet with why, that nothing of his is lost,
 * and the store button. The drawing and the sheet rise in once and settle (still under reduced motion).
 */
export function UpdateRequired() {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const insets = useSafeAreaInsets();
  const food = theme.services.food;
  useAnnounce(`${t('partner.update_title')}. ${t('partner.update_body')}`, { initial: true });

  useEffect(() => {
    void syncBackgroundLocation({ online: false, onJob: false, vehicleClass: null });
  }, []);

  const openStore = async () => {
    // iOS gets its App Store link once the listing exists (docs/before-launch.md, store setup).
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL(PLAY_APP);
        return;
      } catch {
        // No Play Store app on this phone: the web page.
      }
    }
    await Linking.openURL(PLAY_WEB).catch(() => undefined);
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      edges={[]}
      testID="update-required"
      footer={
        <View style={{ paddingHorizontal: theme.space[6] }}>
          <Button testID="update-store" label={t('partner.update_button')} icon="refresh" size="lg" fullWidth onPress={() => void openStore()} />
        </View>
      }
    >
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, minHeight: 260, paddingTop: insets.top + theme.space[4], overflow: 'hidden' }}>
          <MeshFill base={food.fill} mesh={food.mesh} />
          <StarPattern color={theme.services.trips.pattern} opacity={0.2} />
          <View style={{ paddingHorizontal: theme.space[6], alignItems: 'flex-start' }}>
            <Wordmark size="md" onSaffron />
          </View>
          <Animated.View entering={presets.panelIn(80)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: theme.space[8] }}>
            <Art name="update" size={264} />
          </Animated.View>
        </View>
        <Animated.View
          entering={presets.sheetIn(0)}
          style={{
            marginTop: -theme.space[8],
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius['2xl'],
            borderTopRightRadius: theme.radius['2xl'],
            paddingHorizontal: theme.space[6],
            paddingTop: theme.space[6],
            paddingBottom: theme.space[2],
            gap: theme.space[2],
            alignItems: 'flex-start',
          }}
        >
          <Text variant="display" face="display" accessibilityRole="header">
            {t('partner.update_title')}
          </Text>
          <Text variant="body" color="textMuted">
            {t('partner.update_body')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[2] }}>
            <Icon name="shield" size={20} color="successText" strokeWidth={2.2} />
            <Text variant="body" weight={600} color="successText" style={{ flexShrink: 1 }}>
              {t('partner.update_safe')}
            </Text>
          </View>
          <View testID="update-offers" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="bell" size={20} color="textMuted" strokeWidth={2} />
            <Text variant="body" color="textMuted" style={{ flexShrink: 1 }}>
              {t('partner.update_offers')}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Screen>
  );
}
