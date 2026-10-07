import { useKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CourierCard } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Avatar, Icon, IconButton, PlateChip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import type { RideVertical } from './logic';
import { rideSwatch } from './swatch';

/**
 * Ride idea d3: a minute before he reaches the pickup, over the map — his face, «عباس قريب، اطلع هسة»,
 * the car to look for, and at night the screen light. The soft buzz comes from the moments hook.
 */
export function RideNearCard({ courier, vehicle, top, night, onLight, onClose }: { courier: CourierCard; vehicle: string | null; top: number; night: boolean; onLight: () => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const name = courier.firstName ?? t('track.driver_fallback');
  return (
    <Animated.View
      testID="ride-near"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        gap: theme.space[3],
        padding: theme.space[3],
        paddingEnd: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.live,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} testID="ride-near-title">
            {t('ride.near_title', { name })}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {[t('ride.near_body'), vehicle].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="ride-near-close" />
      </View>
      {night ? <LightButton onPress={onLight} /> : null}
    </Animated.View>
  );
}

/** «ضوّي الشاشة» (ride idea d4): opens the full-screen light. */
export function LightButton({ onPress, tone = 'surface' }: { onPress: () => void; tone?: 'surface' | 'onFill' }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="ride-light-button"
      accessibilityRole="button"
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: tone === 'onFill' ? palette.neutral[900] : theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <Icon name="bulb" size={18} color="text" strokeWidth={2.2} />
      <Text variant="label" weight={600}>
        {t('ride.light_button')}
      </Text>
    </Pressable>
  );
}

/**
 * Ride idea d4: the whole screen in the service's colour (taxi yellow, tuktuk plum) with his plate
 * and «أني هنا», breathing slowly so it catches the eye in a dark street without flashing; the
 * phone stays awake while it is up. One tap anywhere on the close button puts it away.
 */
export function ScreenLight({ visible, vertical, courier, onClose }: { visible: boolean; vertical: RideVertical; courier: CourierCard; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {visible ? <LightFace vertical={vertical} courier={courier} onClose={onClose} /> : null}
    </Modal>
  );
}

function LightFace({ vertical, courier, onClose }: { vertical: RideVertical; courier: CourierCard; onClose: () => void }) {
  useKeepAwake('ride-light');
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const swatch = rideSwatch(vertical, 'light');
  const glow = useSharedValue(0);
  useEffect(() => {
    // A slow breath (1.6 s each way), far under any flash rate; still under reduced motion.
    if (!theme.reduceMotion) glow.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [glow, theme.reduceMotion]);
  const wash = useAnimatedStyle(() => ({ opacity: 0.16 * glow.value }));
  const name = courier.firstName ?? t('track.driver_fallback');
  return (
    <View testID="ride-light" style={{ flex: 1, backgroundColor: swatch.fill, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom + theme.space[5], paddingHorizontal: theme.space[5] }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.neutral[0] }, wash]} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space[6] }}>
        <Text variant="display" align="center" style={{ color: swatch.on, fontSize: 64, lineHeight: 80 }} testID="ride-light-title">
          {t('ride.light_title')}
        </Text>
        {courier.plate ? (
          <View style={{ transform: [{ scale: 1.5 }], marginVertical: theme.space[4] }}>
            <PlateChip plate={courier.plate} accessibilityLabel={t('driver.plate')} size="xl" testID="ride-light-plate" />
          </View>
        ) : null}
        <Text variant="title" align="center" style={{ color: swatch.on, maxWidth: 320 }}>
          {t('ride.light_hint', { name })}
        </Text>
      </View>
      <Pressable
        testID="ride-light-close"
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => ({
          alignSelf: 'stretch',
          minHeight: 56,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.xl,
          borderWidth: 2,
          borderColor: swatch.on,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text variant="bodyStrong" style={{ color: swatch.on }}>
          {t('ride.light_close')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Ride idea s1: at night the trip can't start without the rider's 4 digits — «گول للسايق هذا الكود قبل
 * ما تصعد», the digits large and spaced so they can be read out at the kerb, and why.
 */
export function StartCode({ code, compact = false }: { code: string; compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="ride-start-code"
      accessible
      accessibilityLabel={`${t('ride.start_code_title')}: ${code.split('').join(' ')}`}
      style={{ gap: theme.space[2], padding: compact ? theme.space[3] : theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="lock" size={16} color="text" strokeWidth={2.2} />
        <Text variant="label" weight={700} style={{ flex: 1 }}>
          {t('ride.start_code_title')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2] }}>
        {code.split('').map((d, i) => (
          <View key={i} style={{ width: compact ? 44 : 52, height: compact ? 52 : 60, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.borderStrong }}>
            <Text variant="display" tabular style={{ fontSize: compact ? 28 : 32, lineHeight: compact ? 36 : 40 }} testID={`ride-start-code-${i}`}>
              {d}
            </Text>
          </View>
        ))}
      </View>
      {compact ? null : (
        <Text variant="footnote" color="textMuted" align="center">
          {t('ride.start_code_why')}
        </Text>
      )}
    </View>
  );
}
