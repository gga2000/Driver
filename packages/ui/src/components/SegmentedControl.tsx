import { useEffect, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** A second, smaller line under the label (e.g. «4 سيارات» under «باچر»). */
  detail?: string;
  /** What a screen reader says instead of label + detail. */
  accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Segments get `${testIDPrefix}-${value}` (default `segment`). */
  testIDPrefix?: string;
}

/** Equal-width segments with a thumb that springs between them (direction-aware). */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel, style, testIDPrefix = 'segment' }: SegmentedControlProps<T>) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const pad = 3;
  const segW = options.length ? (width - pad * 2) / options.length : 0;
  // A value that is none of the options shows no thumb (VIS-08), not the first option as if chosen.
  const found = options.findIndex((o) => o.value === value);
  const index = Math.max(0, found);
  const x = useSharedValue(0);
  const sign = theme.isRTL ? -1 : 1;
  const spring = theme.motion.spring.select;

  useEffect(() => {
    const target = sign * index * segW;
    x.value = theme.reduceMotion || width === 0 ? target : withSpring(target, { ...spring, damping: 18 });
  }, [index, segW, sign, x, theme.reduceMotion, spring, width]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row', padding: pad, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }, style]}
    >
      {width > 0 && found >= 0 ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: pad,
              bottom: pad,
              start: pad,
              width: segW,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.segmentSelected,
              // The chosen segment shows by outline and weight, not only by a 1.2:1 fill (audit S-04).
              borderWidth: 1.5,
              borderColor: theme.colors.segmentSelectedBorder,
              shadowColor: theme.colors.shadow,
              shadowOpacity: theme.elevation[2].shadowOpacity,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            },
            thumb,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityLabel={o.accessibilityLabel ?? (o.detail ? `${o.label} ${o.detail}` : o.label)}
            testID={`${testIDPrefix}-${o.value}`}
            onPress={() => {
              if (!selected) {
                theme.haptic('selection');
                onChange(o.value);
              }
            }}
            style={{ flex: 1, minHeight: theme.hitTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[2] }}
          >
            <Text variant="label" weight={selected ? 700 : 500} color={selected ? 'onSegmentSelected' : 'textMuted'} numberOfLines={1} compact>
              {o.label}
            </Text>
            {o.detail ? (
              <Text variant="caption" weight={selected ? 600 : 400} color={selected ? 'onSegmentSelected' : 'textMuted'} numberOfLines={1} compact tabular>
                {o.detail}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
