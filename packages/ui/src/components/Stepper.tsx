import { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { t } from '@driver/i18n';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeProvider';

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  /** Read before the number, e.g. "العدد". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function clampStep(value: number, delta: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value + delta));
}

export function Stepper({ value, onChange, min = 0, max = 99, size = 'md', accessibilityLabel, style }: StepperProps) {
  const theme = useTheme();
  const bump = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (theme.reduceMotion) return;
    bump.value = withSequence(withTiming(1.18, { duration: theme.motion.duration.instant }), withSpring(1, theme.motion.spring.select));
  }, [value, bump, theme.reduceMotion, theme.motion]);
  const numStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  const btn = size === 'sm' ? 36 : 44;
  return (
    <View
      accessible={false}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: theme.space[1],
          padding: 2,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surfaceSunken,
        },
        style,
      ]}
    >
      <IconButton
        icon="minus"
        size={btn}
        variant="plain"
        accessibilityLabel={t('ui.decrease')}
        disabled={value <= min}
        onPress={() => onChange(clampStep(value, -1, min, max))}
        testID="stepper-dec"
      />
      <Animated.View style={[{ minWidth: 28, alignItems: 'center' }, numStyle]}>
        <Text
          variant={size === 'sm' ? 'bodyStrong' : 'title'}
          tabular
          accessibilityLabel={accessibilityLabel ? `${accessibilityLabel} ${value}` : String(value)}
          accessibilityLiveRegion="polite"
          testID="stepper-value"
        >
          {value}
        </Text>
      </Animated.View>
      <IconButton
        icon="plus"
        size={btn}
        variant="accent"
        accessibilityLabel={t('ui.increase')}
        disabled={value >= max}
        onPress={() => onChange(clampStep(value, 1, min, max))}
        testID="stepper-inc"
      />
    </View>
  );
}
