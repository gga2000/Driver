import { Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art, Button, Icon, MeshFill, Screen, StarPattern, Text, useAnnounce, useMotionPresets, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { STORE_URL } from '@/lib/app-update';
import { Wordmark } from './Wordmark';

/**
 * CORE-05: the server turned this build away (`update_required`). One page in place of every screen,
 * with nothing on it that needs the network. Saffron dawn (Ali, 2026-10-08, concept A): the food
 * tile's saffron with the khatam star lines and the phone getting its update on top, then a cream
 * sheet with why, that nothing is lost, and the store button. The drawing and the sheet rise in
 * once and settle (still under reduced motion). It stays until the app restarts on a new build; no
 * call is retried behind it.
 */
export function UpdateRequired() {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const insets = useSafeAreaInsets();
  const food = theme.services.food;
  useAnnounce(`${t('update.title')}. ${t('error.update_required')}`, { initial: true });
  return (
    <Screen
      scroll={false}
      padded={false}
      edges={[]}
      testID="update-required"
      footer={
        // Play on Android (the web build is never turned away; it shows the same page if it ever were).
        Platform.OS !== 'ios' ? (
          <View style={{ paddingHorizontal: theme.space[6] }}>
            <Button label={t('update.cta')} icon="refresh" fullWidth onPress={() => void Linking.openURL(STORE_URL)} testID="update-required-store" />
          </View>
        ) : null
      }
    >
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, minHeight: 280, paddingTop: insets.top + theme.space[4], overflow: 'hidden' }}>
          <MeshFill base={food.fill} mesh={food.mesh} />
          <StarPattern color={theme.services.trips.pattern} opacity={0.2} />
          <View style={{ paddingHorizontal: theme.space[6], alignItems: 'flex-start' }}>
            <Wordmark size="md" onSaffron />
          </View>
          <Animated.View entering={presets.panelIn(80)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: theme.space[8] }}>
            <Art name="update" size={288} />
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
          <View style={{ backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: theme.space[1] }}>
            <Text variant="label" weight={600} color="accentText">
              {t('update.chip')}
            </Text>
          </View>
          <Text variant="display" face="display" accessibilityRole="header">
            {t('update.title')}
          </Text>
          <Text variant="body" color="textMuted">
            {t('error.update_required')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[2] }}>
            <Icon name="shield" size={20} color="successText" strokeWidth={2.2} />
            <Text variant="body" weight={600} color="successText" style={{ flexShrink: 1 }}>
              {t('update.safe')}
            </Text>
          </View>
          {Platform.OS === 'ios' ? (
            <Text variant="body" weight={600} style={{ marginTop: theme.space[2] }}>
              {t('update.hint_store')}
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Screen>
  );
}
