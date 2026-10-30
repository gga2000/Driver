import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { parcelSwatch } from './palette';

/**
 * The receipt code as a henna wax seal on the tag (concept B1): «الرمز» over the four digits. It presses
 * down once when the page opens (scale and fade only, then still); reduce-motion shows it in place.
 */
export function WaxSeal({ pin, size = 112, testID = 'parcel-seal' }: { pin: string; size?: number; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const sw = parcelSwatch(theme);
  const press = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    press.value = withDelay(180, withSpring(1, { damping: 11, stiffness: 180, mass: 0.8 }));
  }, [press, theme.reduceMotion]);
  const fade = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!theme.reduceMotion) fade.value = withDelay(180, withTiming(1, { duration: 160 }));
  }, [fade, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: 1.22 - 0.22 * press.value }, { rotate: `${-8 + 8 * press.value}deg` }] }));
  const digits = size >= 100 ? 30 : 24;

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('parcel.c_seal_a11y', { pin: pin.split('').join(' ') })}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: sw.fill,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: sw.fill,
          shadowOpacity: theme.scheme === 'dark' ? 0 : 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        },
        style,
      ]}
    >
      {/* The pressed rim: a thin ring inside the wax edge. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 6, start: 6, end: 6, bottom: 6, borderRadius: size / 2, borderWidth: 1.5, borderColor: withAlpha(sw.on, 0.35) }} />
      <Text variant="caption" weight={600} color={withAlpha(sw.on, 0.85)} align="center" style={{ lineHeight: 16 }}>
        {t('parcel.c_seal_label')}
      </Text>
      <Text variant="numeralMd" color={sw.on} align="center" tabular style={{ fontSize: digits, lineHeight: digits + 8, letterSpacing: 2 }} testID={`${testID}-pin`}>
        {pin}
      </Text>
    </Animated.View>
  );
}
