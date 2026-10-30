import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { LatLng } from '@driver/contracts';
import { Button, Icon, IconButton, Text, useTheme, withAlpha } from '@driver/ui';
import { color as palette } from '@driver/design-tokens';
import { WALK_DRAW_MS, walkColours } from '@driver/map/pieces/walk';
import { project, type Size } from '@/features/track/geo';
import type { CameraValues } from '@/features/track/map/types';
import { useT } from '@/lib/i18n';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The map's walk colours: ink dots on a cream halo, readable on every light of the map. */
const WALK = walkColours('day');

interface LayerProps {
  cam: CameraValues;
  size: SharedValue<Size>;
}

/**
 * The dotted walk from where he stands to the stop (N10): ink dots on a soft white road, drawn once
 * from his end to the stop and then still; already whole under reduce-motion.
 */
export function WalkLine({ cam, size, from, to, testID }: LayerProps & { from: LatLng; to: LatLng; testID?: string }) {
  const theme = useTheme();
  const k = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) {
      k.value = 1;
      return;
    }
    k.value = 0;
    k.value = withTiming(1, { duration: WALK_DRAW_MS, easing: Easing.out(Easing.cubic) });
  }, [from.lat, from.lng, to.lat, to.lng, k, theme.reduceMotion]);
  const props = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const a = project(from.lat, from.lng, c, size.value);
    const b = project(from.lat + (to.lat - from.lat) * k.value, from.lng + (to.lng - from.lng) * k.value, c, size.value);
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}` };
  }, [from.lat, from.lng, to.lat, to.lng]);
  return (
    <View testID={testID} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <AnimatedPath animatedProps={props} stroke={WALK.halo} strokeWidth={10} strokeLinecap="round" fill="none" strokeOpacity={0.85} />
        <AnimatedPath animatedProps={props} stroke={WALK.dot} strokeWidth={5} strokeLinecap="round" strokeDasharray="0.1 10" fill="none" />
      </Svg>
    </View>
  );
}

const PIN_W = 140;
const PIN_H = 64;
const PILL_H = 32;
const DOT = 14;

/**
 * A walk end on the map: where he stands («أنت هنا», an ink pill over a dark dot) or the stop
 * («اوكف هنا», a saffron pill over a saffron dot ringed in cream). Anchored at the dot's centre.
 */
export function WalkPin({ cam, size, at, kind, label, testID }: LayerProps & { at: LatLng; kind: 'you' | 'stop'; label: string; testID?: string }) {
  const theme = useTheme();
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - PIN_W / 2 }, { translateY: p.y - PIN_H + DOT / 2 }] };
  }, [at.lat, at.lng]);
  const stop = kind === 'stop';
  const fill = stop ? theme.colors.deal : theme.colors.text;
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: PIN_W, height: PIN_H, alignItems: 'center', justifyContent: 'flex-end' }, place]}>
      <View
        style={{
          paddingHorizontal: 12,
          height: PILL_H,
          borderRadius: 12,
          justifyContent: 'center',
          backgroundColor: fill,
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }}
      >
        <Text variant="label" weight={700} color={stop ? 'onDeal' : 'surface'} numberOfLines={1} style={{ maxWidth: PIN_W - 24 }}>
          {label}
        </Text>
      </View>
      <View style={{ height: 6 }} />
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: fill, borderWidth: 3, borderColor: stop ? theme.colors.text : theme.colors.surface, ...(stop ? {} : { shadowColor: theme.colors.accent, shadowOpacity: 0.5, shadowRadius: 8 }) }} />
    </Animated.View>
  );
}

/**
 * The offer on the choose sheet (N10): «أسرع بـ» only when the nearest car really reaches the stop
 * sooner, how far the walk is, where the driver stops, and the two choices: walk there, or the
 * driver to the door (with its price difference, as the pickup options say).
 */
export function WalkToStopCard({
  walkMin,
  walkM,
  landmark,
  arrivesMin,
  faster,
  doorLabel,
  onWalk,
  onDoor,
  onStay,
}: {
  walkMin: number;
  walkM: number;
  landmark: string | null;
  arrivesMin: number | null;
  faster: number | null;
  doorLabel: string;
  onWalk: () => void;
  onDoor: () => void;
  onStay: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const chip = (label: string, tone: 'deal' | 'plain', testID: string) => (
    <View testID={testID} style={{ paddingHorizontal: 10, minHeight: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: tone === 'deal' ? theme.colors.deal : theme.colors.surfaceSunken }}>
      <Text variant="caption" weight={700} color={tone === 'deal' ? 'onDeal' : 'textMuted'} tabular style={{ lineHeight: 18 }}>
        {label}
      </Text>
    </View>
  );
  return (
    <View
      testID="ride-walk-offer"
      accessibilityRole="summary"
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: withAlpha(theme.colors.accent, 0.35) }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {faster ? chip(t('ride.walk_faster', { n: faster }), 'deal', 'ride-walk-faster') : null}
          {chip(t('ride.walk_metres', { m: walkM }), 'plain', 'ride-walk-metres')}
        </View>
        <IconButton icon="x" size={44} variant="plain" accessibilityLabel={t('ride.walk_stay')} onPress={onStay} testID="ride-walk-stay" />
      </View>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="title" weight={700} accessibilityRole="header">
          {t('ride.walk_title', { n: walkMin })}
        </Text>
        <Text variant="body" color="textMuted">
          {landmark ? t('ride.walk_body', { place: landmark }) : t('ride.walk_body_road')}
          {arrivesMin != null ? ` ${t('ride.walk_arrives', { n: arrivesMin })}` : ''}
        </Text>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Button testID="ride-walk-go" fullWidth label={t('ride.walk_go')} onPress={onWalk} />
        <Button testID="ride-walk-door" fullWidth variant="secondary" label={doorLabel} onPress={onDoor} />
      </View>
    </View>
  );
}

/** After «تمام، أمشي هسة»: one line saying where he waits, and the way back to his own spot. */
export function WalkChosenNote({ walkM, landmark, onUndo }: { walkM: number; landmark: string | null; onUndo: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="ride-walk-chosen" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingStart: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint }}>
      <Icon name="location-arrow" size={18} color="accentText" strokeWidth={2.2} />
      <Text variant="footnote" weight={600} color="accentText" style={{ flex: 1, paddingVertical: theme.space[2] }}>
        {landmark ? t('ride.walk_chosen', { m: walkM, place: landmark }) : t('ride.walk_chosen_road', { m: walkM })}
      </Text>
      <Button testID="ride-walk-undo" size="md" variant="ghost" label={t('ride.walk_undo')} onPress={onUndo} />
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0 },
});
