import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '@driver/ui';

/**
 * Progress that glides by moving, not by resizing (speed audit m2): animating `width` or `start`
 * relays out the bar every frame, which stutters on cheap phones; a transform runs on the UI thread.
 * `onLayout` goes on the track; `fill` on a full-width bar inside it (track `overflow: 'hidden'`),
 * slid toward the start by the part not yet done; `marker` on a piece placed at the track's start,
 * slid toward the end by the part done. Transforms are physical, so RTL flips the direction. Hidden
 * until the track is measured, so a full bar never flashes.
 */
export function useGlide(fraction: SharedValue<number>) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const toEnd = theme.isRTL ? -1 : 1;
  const fill = useAnimatedStyle(() => ({
    opacity: width > 0 ? 1 : 0,
    transform: [{ translateX: (fraction.value - 1) * width * toEnd }],
  }));
  const marker = useAnimatedStyle(() => ({
    opacity: width > 0 ? 1 : 0,
    transform: [{ translateX: fraction.value * width * toEnd }],
  }));
  return { onLayout, fill, marker };
}
