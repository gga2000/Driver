import { useEffect, useState } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  /** Text-line placeholder: several bars, the last one shorter. */
  lines?: number;
  style?: StyleProp<ViewStyle>;
}

function Bar({ width = '100%', height = 14, radius, style }: Omit<SkeletonProps, 'lines'>) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion || w === 0) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: theme.motion.duration.shimmer, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(x);
  }, [w, theme.reduceMotion, theme.motion.duration.shimmer, x]);
  const band = Math.max(40, w * 0.35);
  const sign = theme.isRTL ? -1 : 1;
  // The band sweeps in the reading direction: right-to-left in Arabic.
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: sign * (-band + x.value * (w + band)) }] }));
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[
        { width, height, borderRadius: radius ?? Math.min(8, height / 2), backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' },
        style,
      ]}
    >
      {theme.reduceMotion ? null : (
        // Three stepped strips fake a soft edge without a gradient.
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, width: band, flexDirection: 'row' }, sweep]}>
          <View style={{ flex: 1, backgroundColor: theme.colors.shimmer, opacity: 0.3 }} />
          <View style={{ flex: 2, backgroundColor: theme.colors.shimmer, opacity: 0.65 }} />
          <View style={{ flex: 1, backgroundColor: theme.colors.shimmer, opacity: 0.3 }} />
        </Animated.View>
      )}
    </View>
  );
}

/** Loading placeholder with a shimmer band. Wrap groups in `accessibilityLabel="لحظة…"` at screen level. */
export function Skeleton({ lines, ...rest }: SkeletonProps) {
  const theme = useTheme();
  if (!lines || lines <= 1) return <Bar {...rest} />;
  return (
    <View style={[{ gap: theme.space[2] }, rest.style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Bar key={i} height={rest.height ?? 12} width={i === lines - 1 ? '60%' : '100%'} radius={rest.radius} />
      ))}
    </View>
  );
}
