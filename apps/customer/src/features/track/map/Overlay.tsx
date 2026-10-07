import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { pinLabelPlacement, pinLabelWidth, type PinLabelLayout, type PinLabelPlacement, type PinLabelSide } from '@driver/map';
import { Icon, Text, useTheme, usePulse, withAlpha } from '@driver/ui';
import { layerTransform, pathD, project, type Camera, type LngLat, type Size } from '../geo';
import { glidePos, remainingFrom, type Glide, type Path as RoadPath } from '../motion';
import { shouldRedraw, type RouteDraw } from '../route-throttle';
import { Vehicle, VEHICLE_SIZE, type VehicleKind } from './Vehicle';
import type { CameraValues } from './types';
import { color as palette } from '@driver/design-tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The courier's glide on the UI thread: the glide, its progress (0..1 over one poll interval, past 1
 * the dead-reckoning tail) and the road path it runs on (null: straight glides).
 */
export interface GlideValues {
  glide: SharedValue<Glide | null>;
  progress: SharedValue<number>;
  path?: SharedValue<RoadPath | null>;
}

interface LayerProps {
  cam: CameraValues;
  size: SharedValue<Size>;
}

/**
 * The route still to drive. With a road path (maps program SP5a): the real streets from the courier's
 * gliding position to the end, solid, shortening behind him. Without one: dashed straight segments
 * through the remaining waypoints — unless `straight` is off (the live order map, joy f19 / L-07: a
 * straight line would cross the river; `HeadingArrow` shows which way he is headed instead).
 */
export function RouteLine({
  cam,
  size,
  glide,
  progress,
  path,
  start,
  waypoints,
  color,
  onRoad = false,
  straight = true,
}: LayerProps & GlideValues & { start: SharedValue<LngLat | null>; waypoints: SharedValue<LngLat[]>; color: string; onRoad?: boolean; straight?: boolean }) {
  // Joy f21 (L-29): the path string is rebuilt at most ~15 times a second and only when he moved a
  // pixel (or the camera drifted far); between rebuilds the drawn path rides the camera with one
  // transform, so a 60 fps glide costs no SVG parsing.
  const d = useSharedValue('');
  const drawn = useSharedValue<Camera | null>(null);
  const last = useSharedValue<RouteDraw | null>(null);
  useAnimatedReaction(
    () => ({ live: { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, g: glide.value, p: progress.value, road: path ? path.value : null, start: start.value, wps: waypoints.value, sz: size.value }),
    ({ live, g, p, road, start: from, wps, sz }) => {
      let pts: LngLat[];
      if (road) {
        if (g) {
          const m = glidePos(g, road, p);
          pts = m.d !== null ? remainingFrom(road, m.d) : [m.pos, ...road.pts];
        } else {
          pts = road.pts;
        }
      } else if (!straight) {
        pts = [];
      } else {
        const head = g ? glidePos(g, null, p).pos : from;
        pts = head ? [head, ...wps] : wps;
      }
      const shape = (road ? road.pts.length * 2 : -wps.length * 2) + (g ? 1 : 0);
      const ref = drawn.value ?? live;
      const head = pts[0] ?? null;
      const h = head ? project(head.lat, head.lng, ref, sz) : { x: 0, y: 0 };
      const t = drawn.value ? layerTransform(drawn.value, live, sz) : { tx: 0, ty: 0, s: 1 };
      const at = Date.now();
      if (!shouldRedraw(last.value, { at, x: h.x, y: h.y, shape, zoomDrift: live.zoom - ref.zoom, panPx: Math.hypot(t.tx, t.ty) })) return;
      d.value = pts.length < 2 ? '' : pathD(pts.map((q) => project(q.lat, q.lng, live, sz)));
      drawn.value = live;
      const now = head ? project(head.lat, head.lng, live, sz) : { x: 0, y: 0 };
      last.value = { at, x: now.x, y: now.y, shape };
    },
    [straight],
  );
  const follow = useAnimatedStyle(() => {
    const dr = drawn.value;
    if (!dr) return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const { tx, ty, s } = layerTransform(dr, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  });
  const props = useAnimatedProps(() => ({ d: d.value }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, follow]}>
      <Svg width="100%" height="100%">
        <AnimatedPath animatedProps={props} stroke={palette.neutral[0]} strokeWidth={onRoad ? 9 : 8} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity={0.9} />
        <AnimatedPath animatedProps={props} stroke={color} strokeWidth={onRoad ? 5 : 4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={onRoad ? undefined : '1 9'} fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** The heading arrow (f19): starts this far from the courier's centre … */
const ARROW_GAP = 32;
/** … and is this long ("a 60 px heading arrow", L-07). */
const ARROW_LEN = 60;
const ARROW_BOX = 2 * (ARROW_GAP + ARROW_LEN);

/**
 * No road route (joy f19, L-07): a short arrow from the courier toward his next stop instead of a
 * straight line across the map. Hidden while a road route is drawn, without a courier, or when he is
 * already closer than the arrow would reach.
 */
export function HeadingArrow({ cam, size, glide, progress, path, waypoints, color, visible }: LayerProps & GlideValues & { waypoints: SharedValue<LngLat[]>; color: string; visible: boolean }) {
  const style = useAnimatedStyle(() => {
    const g = glide.value;
    const to = waypoints.value[0];
    const hidden = { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }] };
    if (!visible || !g || !to) return hidden;
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const pos = glidePos(g, path ? path.value : null, progress.value).pos;
    const p = project(pos.lat, pos.lng, c, size.value);
    const q = project(to.lat, to.lng, c, size.value);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (Math.hypot(dx, dy) < ARROW_GAP + ARROW_LEN) return hidden;
    return { opacity: 1, transform: [{ translateX: p.x - ARROW_BOX / 2 }, { translateY: p.y - ARROW_BOX / 2 }, { rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }] };
  }, [visible]);
  const mid = ARROW_BOX / 2;
  const tip = mid + ARROW_GAP + ARROW_LEN;
  return (
    <Animated.View testID="heading-arrow" pointerEvents="none" style={[styles.anchor, { width: ARROW_BOX, height: ARROW_BOX }, style]}>
      <Svg width={ARROW_BOX} height={ARROW_BOX}>
        <Path d={`M ${mid + ARROW_GAP} ${mid} L ${tip - 8} ${mid}`} stroke={palette.neutral[0]} strokeWidth={8} strokeLinecap="round" strokeOpacity={0.9} />
        <Path d={`M ${mid + ARROW_GAP} ${mid} L ${tip - 8} ${mid}`} stroke={color} strokeWidth={4} strokeLinecap="round" />
        <Path d={`M ${tip} ${mid} L ${tip - 14} ${mid - 9} L ${tip - 14} ${mid + 9} Z`} fill={color} stroke={palette.neutral[0]} strokeWidth={1.5} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

const MARKER = 60;
/** The unreachable spotlight around the courier (L-10: "a 140 px circle around the marker"). */
const SPOTLIGHT = 140;

/**
 * The courier: our top-down vehicle turning with his heading as he glides along the road, a soft
 * pulse while live, and the minutes to arrival in a pill above (not rotated). Grey and still when his
 * signal is lost.
 */
export function CourierMarker({
  cam,
  size,
  glide,
  progress,
  path,
  kind,
  stale,
  minutes,
  spotlight = false,
  testID,
}: LayerProps & GlideValues & { kind: VehicleKind; stale: boolean; minutes: string | null; /** Unreachable (f18): a ring around him so the customer sees where he stands. */ spotlight?: boolean; testID?: string }) {
  const theme = useTheme();
  const pulse = usePulse(!stale);
  const place = useAnimatedStyle(() => {
    const g = glide.value;
    if (!g) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const { pos } = glidePos(g, path ? path.value : null, progress.value);
    const p = project(pos.lat, pos.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { opacity: 1, transform: [{ translateX: p.x - MARKER / 2 }, { translateY: p.y - MARKER / 2 }] };
  });
  const turn = useAnimatedStyle(() => {
    const g = glide.value;
    return { transform: [{ rotate: `${g ? glidePos(g, path ? path.value : null, progress.value).heading : 0}deg` }] };
  });
  const halo = stale ? theme.colors.textMuted : theme.colors.accent;
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: MARKER, height: MARKER }, place]}>
      {spotlight ? (
        <View
          testID="courier-spotlight"
          style={{ position: 'absolute', left: (MARKER - SPOTLIGHT) / 2, top: (MARKER - SPOTLIGHT) / 2, width: SPOTLIGHT, height: SPOTLIGHT, borderRadius: SPOTLIGHT / 2, borderWidth: 3, borderColor: theme.colors.accent, backgroundColor: withAlpha(theme.colors.accent, 0.12) }}
        />
      ) : null}
      <Animated.View style={[styles.center, { width: MARKER, height: MARKER, borderRadius: MARKER / 2, backgroundColor: withAlpha(halo, 0.2) }, stale ? null : pulse]} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, turn]}>
        <Vehicle kind={kind} body={theme.colors.accent} ink={theme.colors.text} glass={theme.colors.surface} shadow={palette.neutral[1000]} muted={stale} />
      </Animated.View>
      {minutes ? (
        <View style={[styles.pillRow, { top: (MARKER - VEHICLE_SIZE) / 2 - 24 }]}>
          <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: stale ? theme.colors.textMuted : theme.colors.text }}>
            <Text variant="caption" weight={700} color="surface" tabular style={{ lineHeight: 16 }}>
              {minutes}
            </Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const PIN_W = 120;
const PIN_H = 64;
/** The pin's name pill, its stem and the tip dot (which tucks 3 px under the stem). */
const PILL_H = 30;
const STEM = 10;
const TIP_DOT = 10;
const DOT_TUCK = 3;
/** Pill padding both sides, the icon and the gap to the text. */
const PILL_CHROME = 10 * 2 + 15 + 4;
const PILL_FONT = 12;
/** The minutes pill over the courier's vehicle: its height and the gap above the vehicle. */
const MINUTES_PILL = 22 + 2;

/**
 * Which side of its pin a place's name goes for one camera (the `@driver/map` rule): under the pin
 * when the courier marker, drawn over the pins, would cover it above (QA 2026-10-07), hanging lower
 * when he stands on the pin itself (`drop`, the courier at the door). `courier` is his last fix;
 * between fixes the glide stays close to it.
 */
export function placePinSide(at: LngLat, label: string, courier: LngLat | null, withMinutes: boolean, cam: Camera, size: Size): PinLabelPlacement {
  if (!courier || size.w === 0) return { side: 'above', drop: 0 };
  const me = project(courier.lat, courier.lng, cam, size);
  const half = VEHICLE_SIZE / 2;
  const marker = { left: me.x - half, right: me.x + half, top: me.y - half - (withMinutes ? MINUTES_PILL : 0), bottom: me.y + half };
  const layout: PinLabelLayout = { width: pinLabelWidth(label, PILL_FONT, PILL_CHROME, PIN_W), height: PILL_H, gapAbove: STEM + TIP_DOT - DOT_TUCK, gapBelow: STEM - DOT_TUCK };
  return pinLabelPlacement(project(at.lat, at.lng, cam, size), [marker], layout);
}

/**
 * A place on the map: home or a ride's destination (dark pill with its label: a house only for the
 * saved home, a flag otherwise, L-15), the kitchen, or the ride pickup. Anchored at its tip; the
 * name sits over it, or under it when `side` is below (`placePinSide`).
 */
export function PlacePin({ cam, size, at, kind, label, side = 'above', drop = 0, testID }: LayerProps & { at: LngLat; kind: 'home' | 'destination' | 'kitchen' | 'pickup'; label: string; side?: PinLabelSide; /** Flipped: how much longer the stem gets, px (`placePinSide`). */ drop?: number; testID?: string }) {
  const theme = useTheme();
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - PIN_W / 2 }, { translateY: side === 'below' ? p.y - TIP_DOT : p.y - PIN_H }] };
  }, [at.lat, at.lng, side]);
  const home = kind === 'home' || kind === 'destination';
  const pickup = kind === 'pickup';
  const fill = home ? theme.colors.text : theme.colors.surface;
  const extra = side === 'below' ? drop : 0;
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: PIN_W, height: PIN_H + extra, alignItems: 'center', justifyContent: side === 'below' ? 'flex-start' : 'flex-end' }, place]}>
      <View style={{ alignItems: 'center', flexDirection: side === 'below' ? 'column-reverse' : 'column' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 10,
            height: PILL_H,
            borderRadius: PILL_H / 2,
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
            <Icon name={kind === 'destination' ? 'flag' : home ? 'home' : 'food'} size={15} color={home ? 'surface' : 'text'} strokeWidth={2.2} />
          )}
          <Text variant="caption" weight={600} color={home ? 'surface' : 'text'} numberOfLines={1} style={{ maxWidth: PIN_W - 44 }}>
            {label}
          </Text>
        </View>
        {/* Stem and the tip dot. */}
        <View style={{ width: 2, height: STEM + extra, backgroundColor: fill === theme.colors.surface ? theme.colors.borderStrong : fill }} />
        <View style={{ width: TIP_DOT, height: TIP_DOT, borderRadius: TIP_DOT / 2, ...(side === 'below' ? { marginBottom: -DOT_TUCK } : { marginTop: -DOT_TUCK }), backgroundColor: home ? theme.colors.accent : pickup ? theme.colors.success : theme.colors.text, borderWidth: 2, borderColor: theme.colors.surface }} />
      </View>
    </Animated.View>
  );
}

const RING = 72;
const RING_R = 30;

/**
 * The kitchen's cooking ring (maps program SP5b, c4): an arc around the kitchen that fills as the
 * promised prep time runs, with a soft breathing halo while it cooks (still under reduce-motion).
 */
export function PrepRing({ cam, size, at, progress, testID }: LayerProps & { at: LngLat; progress: number; testID?: string }) {
  const theme = useTheme();
  const pulse = usePulse(!theme.reduceMotion);
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - RING / 2 }, { translateY: p.y - RING / 2 }] };
  }, [at.lat, at.lng]);
  const c = 2 * Math.PI * RING_R;
  return (
    <Animated.View testID={testID} pointerEvents="none" accessibilityElementsHidden style={[styles.anchor, { width: RING, height: RING }, place]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: RING / 2, backgroundColor: withAlpha(theme.colors.accent, 0.14) }, pulse]} />
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={withAlpha(theme.colors.accent, 0.25)} strokeWidth={5} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          stroke={theme.colors.accent}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c * progress} ${c}`}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
    </Animated.View>
  );
}

const RADAR = 240;

/**
 * "ندور لك سايق": rings sweeping out from the pickup while dispatch broadcasts the ride (customer
 * spec §5). Three staggered rings on the UI thread; still under reduce-motion. `reach` (0–1) is how
 * far they spread: the search waves widen it, nearest drivers first, then everyone (ride idea m1).
 */
export function RadarPulse({ cam, size, at, reach = 1, testID }: LayerProps & { at: LngLat; reach?: number; testID?: string }) {
  const theme = useTheme();
  const spread = useSharedValue(reach);
  useEffect(() => {
    spread.value = theme.reduceMotion ? reach : withTiming(reach, { duration: 900, easing: Easing.inOut(Easing.cubic) });
  }, [reach, spread, theme.reduceMotion]);
  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - RADAR / 2 }, { translateY: p.y - RADAR / 2 }] };
  }, [at.lat, at.lng]);
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.anchor, { width: RADAR, height: RADAR }, place]}>
      {[0, 1, 2].map((i) => (
        <RadarRing key={i} delay={i * 700} color={theme.colors.accent} still={theme.reduceMotion} spread={spread} />
      ))}
    </Animated.View>
  );
}

function RadarRing({ delay, color, still, spread }: { delay: number; color: string; still: boolean; spread: SharedValue<number> }) {
  const p = useSharedValue(still ? 0.5 : 0);
  useEffect(() => {
    if (still) return;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.cubic) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p, still]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - p.value), transform: [{ scale: 0.12 + p.value * 0.88 * spread.value }] }));
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
  pillRow: { position: 'absolute', left: -20, right: -20, alignItems: 'center' },
});
