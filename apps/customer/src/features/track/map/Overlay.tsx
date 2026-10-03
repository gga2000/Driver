import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Icon, Text, useTheme, usePulse, withAlpha, type IconName } from '@driver/ui';
import { glideAt, pathD, project, type Glide, type LngLat, type Size } from '../geo';
import type { CameraValues } from './types';
import { color as palette } from '@driver/design-tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The courier's glide on the UI thread: segment + progress (0..1 over one poll interval). */
export interface GlideValues {
  glide: SharedValue<Glide | null>;
  progress: SharedValue<number>;
}

interface LayerProps {
  cam: CameraValues;
  size: SharedValue<Size>;
}

/**
 * The route still to drive: from the courier's gliding position (or the route start before a
 * courier exists) through the remaining waypoints. Straight segments — there is no road router
 * yet, so the line is dashed and honest about it — shortening as he moves.
 */
export function RouteLine({ cam, size, glide, progress, start, waypoints, color }: LayerProps & GlideValues & { start: SharedValue<LngLat | null>; waypoints: SharedValue<LngLat[]>; color: string }) {
  const props = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const g = glide.value;
    const head = g ? glideAt(g, progress.value).pos : start.value;
    const pts = head ? [head, ...waypoints.value] : waypoints.value;
    if (pts.length < 2) return { d: '' };
    return { d: pathD(pts.map((p) => project(p.lat, p.lng, c, size.value))) };
  });
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <AnimatedPath animatedProps={props} stroke={palette.neutral[0]} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity={0.9} />
      <AnimatedPath animatedProps={props} stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 9" fill="none" />
    </Svg>
  );
}

const MARKER = 60;

/** Gliding, rotating courier marker: upright vehicle glyph in a disc, a heading pointer that turns. */
export function CourierMarker({ cam, size, glide, progress, icon, stale, testID }: LayerProps & GlideValues & { icon: IconName; stale: boolean; testID?: string }) {
  const theme = useTheme();
  const pulse = usePulse(!stale);
  const place = useAnimatedStyle(() => {
    const g = glide.value;
    if (!g) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const { pos } = glideAt(g, progress.value);
    const p = project(pos.lat, pos.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { opacity: 1, transform: [{ translateX: p.x - MARKER / 2 }, { translateY: p.y - MARKER / 2 }] };
  });
  const turn = useAnimatedStyle(() => {
    const g = glide.value;
    return { transform: [{ rotate: `${g ? glideAt(g, progress.value).heading : 0}deg` }] };
  });
  const ring = stale ? theme.colors.textMuted : theme.colors.accent;
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: MARKER, height: MARKER }, place]}>
      <Animated.View style={[styles.center, { width: MARKER, height: MARKER, borderRadius: MARKER / 2, backgroundColor: withAlpha(ring, 0.22) }, stale ? null : pulse]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, turn]}>
        {/* Heading pointer at the top edge; the whole ring turns with the bearing. */}
        <View style={{ position: 'absolute', top: 4, width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ring }} />
      </Animated.View>
      <View
        style={[
          styles.center,
          {
            position: 'absolute',
            top: (MARKER - 38) / 2,
            left: (MARKER - 38) / 2,
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: theme.colors.surface,
            borderWidth: 3,
            borderColor: ring,
            shadowColor: palette.neutral[1000],
            shadowOpacity: 0.18,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          },
        ]}
      >
        <Icon name={icon} size={20} color={stale ? 'textMuted' : 'accentText'} strokeWidth={2.2} />
      </View>
    </Animated.View>
  );
}

const PIN_W = 120;
const PIN_H = 64;

/** A place on the map: the home pin (with its label) or the kitchen. Anchored at its tip. */
export function PlacePin({ cam, size, at, kind, label, testID }: LayerProps & { at: LngLat; kind: 'home' | 'kitchen' | 'pickup'; label: string; testID?: string }) {
  const theme = useTheme();
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - PIN_W / 2 }, { translateY: p.y - PIN_H }] };
  }, [at.lat, at.lng]);
  const home = kind === 'home';
  const pickup = kind === 'pickup';
  const fill = home ? theme.colors.text : theme.colors.surface;
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: PIN_W, height: PIN_H, alignItems: 'center', justifyContent: 'flex-end' }, place]}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 10,
            height: 30,
            borderRadius: 15,
            backgroundColor: fill,
            borderWidth: home ? 0 : 1.5,
            borderColor: theme.colors.borderStrong,
            shadowColor: palette.neutral[1000],
            shadowOpacity: 0.16,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        >
          {pickup ? (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.success, borderWidth: 2, borderColor: withAlpha(theme.colors.success, 0.3) }} />
          ) : (
            <Icon name={home ? 'home' : 'bag'} size={15} color={home ? 'surface' : 'text'} strokeWidth={2.2} />
          )}
          <Text variant="caption" weight={600} color={home ? 'surface' : 'text'} numberOfLines={1} style={{ maxWidth: PIN_W - 44 }}>
            {label}
          </Text>
        </View>
        {/* Stem and the tip dot. */}
        <View style={{ width: 2, height: 10, backgroundColor: fill === theme.colors.surface ? theme.colors.borderStrong : fill }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: -3, backgroundColor: home ? theme.colors.accent : pickup ? theme.colors.success : theme.colors.text, borderWidth: 2, borderColor: theme.colors.surface }} />
      </View>
    </Animated.View>
  );
}

const RADAR = 240;

/**
 * "ندور لك سايق": rings sweeping out from the pickup while dispatch broadcasts the ride (customer
 * spec §5). Three staggered rings on the UI thread; still under reduce-motion.
 */
export function RadarPulse({ cam, size, at, testID }: LayerProps & { at: LngLat; testID?: string }) {
  const theme = useTheme();
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - RADAR / 2 }, { translateY: p.y - RADAR / 2 }] };
  }, [at.lat, at.lng]);
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: RADAR, height: RADAR }, place]}>
      {[0, 1, 2].map((i) => (
        <RadarRing key={i} delay={i * 700} color={theme.colors.accent} still={theme.reduceMotion} />
      ))}
    </Animated.View>
  );
}

function RadarRing({ delay, color, still }: { delay: number; color: string; still: boolean }) {
  const p = useSharedValue(still ? 0.5 : 0);
  useEffect(() => {
    if (still) return;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.cubic) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p, still]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - p.value), transform: [{ scale: 0.12 + p.value * 0.88 }] }));
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: RADAR / 2, borderWidth: 2, borderColor: color, backgroundColor: withAlpha(color, 0.12) },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
