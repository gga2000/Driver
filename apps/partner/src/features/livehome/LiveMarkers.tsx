import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { color as palette } from '@driver/design-tokens';
import { Icon, Text, usePulse, useTheme, withAlpha } from '@driver/ui';
import { RISE_MS } from './live-map-shared';

/**
 * The phone versions of the live map's markers (web: the `lv-*` pieces in LiveTownMap.web.tsx), drawn
 * in React Native inside MapLibre Native markers. Each plays once when it appears; with reduce motion
 * they simply show.
 */

const FLAME = '#D9540F';
const shadow = { shadowColor: palette.neutral[1000], shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 };

/** Grows in once (a small spring-like pop). */
function usePop(reduce: boolean, delay = 0, strong = false) {
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(delay, withTiming(1, { duration: strong ? 600 : 500, easing: Easing.out(Easing.back(strong ? 2.2 : 1.6)) }));
  }, [p, reduce, delay, strong]);
  return useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.6), transform: [{ scale: 0.4 + 0.6 * p.value }] }));
}

/** The little tail under a bubble, pointing at its shop. */
function Tail({ fill }: { fill: string }) {
  return <View style={{ alignSelf: 'center', width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: fill }} />;
}

/** A filling ring for «يطبخ» (how far the kitchen is into its cooking time). */
function Progress({ p }: { p: number }) {
  const theme = useTheme();
  const r = 7.5;
  const len = 2 * Math.PI * r;
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      <Circle cx={10} cy={10} r={r} stroke={theme.colors.surfaceSunken} strokeWidth={3.5} fill="none" />
      <Circle cx={10} cy={10} r={r} stroke={FLAME} strokeWidth={3.5} fill="none" strokeDasharray={`${len * Math.max(0, Math.min(1, p))} ${len}`} transform="rotate(-90 10 10)" />
    </Svg>
  );
}

/** «يطبخ» with its ring, or saffron «جاهز» (popping when it just turned ready). */
export function KitchenBubble({ ready, progress, popped, label, word }: { ready: boolean; progress: number | null; popped: boolean; label: string; word: string }) {
  const theme = useTheme();
  const pop = usePop(theme.reduceMotion, 0, popped);
  const fill = ready ? theme.colors.accent : theme.colors.surface;
  return (
    <Animated.View pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={label} testID={ready ? 'live-kitchen-ready' : 'live-kitchen-cooking'} style={[{ alignItems: 'center', paddingBottom: 16 }, pop]}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, paddingStart: ready ? 8 : 4, paddingEnd: 10, borderRadius: 999, backgroundColor: fill }, shadow]}>
        {ready ? <Icon name="check" size={15} color="onAccent" strokeWidth={2.4} /> : <Progress p={progress ?? 0} />}
        {ready ? null : <Icon name="flame" size={14} color={FLAME} strokeWidth={2.2} />}
        <Text variant="caption" weight={700} color={ready ? 'onAccent' : 'text'} style={{ fontSize: 12.5 }} numberOfLines={1}>
          {word}
        </Text>
      </View>
      <Tail fill={fill} />
    </Animated.View>
  );
}

/** «3 سواق»: drivers per part of town, never a dot per driver. */
export function DriverCount({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" testID="live-drivers" style={[{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, height: 22, borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.88) }, shadow, { shadowOpacity: 0.1 }]}>
      <Icon name="bike" size={13} color="textMuted" />
      <Text variant="caption" weight={600} color="textMuted" style={{ fontSize: 11 }} tabular numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** «طلب جديد» rising over an area, once, then gone. */
export function RiseChip({ text }: { text: string }) {
  const theme = useTheme();
  const reduce = theme.reduceMotion;
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.quad) });
  }, [p, reduce]);
  const style = useAnimatedStyle(() => {
    const t = p.value;
    const opacity = reduce ? 1 : t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;
    const y = reduce ? 0 : t < 0.15 ? 8 * (1 - t / 0.15) : -26 * ((t - 0.15) / 0.85);
    return { opacity, transform: [{ translateY: y }, { scale: reduce || t >= 0.15 ? 1 : 0.7 + (0.3 * t) / 0.15 }] };
  });
  return (
    <Animated.View pointerEvents="none" testID="live-ripple" style={[{ paddingHorizontal: 9, height: 24, justifyContent: 'center', borderRadius: 999, backgroundColor: theme.colors.accentTint, marginBottom: 10 }, shadow, style]}>
      <Text variant="caption" weight={700} color="accentText" style={{ fontSize: 12 }} numberOfLines={1}>
        {text}
      </Text>
    </Animated.View>
  );
}

/** Him: the saffron dot with a soft ring that breathes a few times while he works; faded behind «يومي». */
export function MeDot({ online, faded }: { online: boolean; faded: boolean }) {
  const theme = useTheme();
  const ring = usePulse(online);
  return (
    <View pointerEvents="none" testID="live-me" style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', opacity: faded ? 0.35 : 1 }}>
      <Animated.View style={[{ position: 'absolute', width: 64, height: 64, borderRadius: 32, backgroundColor: withAlpha(theme.colors.accent, 0.5) }, ring]} />
      <View style={[{ width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: '#FFFCF7', backgroundColor: online ? theme.colors.accent : theme.colors.textMuted, alignItems: 'center', justifyContent: 'center' }, shadow]}>
        <Icon name="location-arrow" size={16} color={online ? 'onAccent' : 'surface'} strokeWidth={2.2} />
      </View>
    </View>
  );
}

/** «يومي»: where he picked up (a bag) and each door (a dark pin). */
export function DayPick() {
  const theme = useTheme();
  return (
    <View pointerEvents="none" testID="live-day-pickup" style={[{ width: 26, height: 26, borderRadius: 8, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }, shadow]}>
      <Icon name="bag" size={14} color="accentText" />
    </View>
  );
}

export function DayDoor() {
  const theme = useTheme();
  return <View pointerEvents="none" style={[{ width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#FFFCF7', backgroundColor: theme.colors.text }, shadow]} />;
}

/** What one delivery earned, popping in one after another. */
export function DayCoin({ text, index, below }: { text: string; index: number; below: boolean }) {
  const theme = useTheme();
  const pop = usePop(theme.reduceMotion, 600 + index * 450);
  return (
    <Animated.View pointerEvents="none" testID="live-day-coin" style={[{ paddingHorizontal: 10, height: 28, justifyContent: 'center', borderRadius: 999, backgroundColor: theme.colors.text, marginTop: below ? 12 : 0, marginBottom: below ? 0 : 12 }, shadow, pop]}>
      <Text variant="caption" weight={700} color="bg" style={{ fontSize: 13 }} tabular numberOfLines={1}>
        {text}
      </Text>
    </Animated.View>
  );
}
