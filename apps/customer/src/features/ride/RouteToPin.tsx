import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { color as palette, services } from '@driver/design-tokens';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { project, type Camera, type LngLat as LatLngPoint, type Size } from '@/features/track/geo';
import type { CameraValues } from '@/features/track/map/types';
import { buildStreetGraph, distanceWords, streetRoute, type LngLat } from './street-route';
import type { WalkRoad } from './walk-stop';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** How often the route is worked out again while the pin moves (a street corner a frame is plenty). */
const LIVE_ROUTE_MS = 70;

export type RouteLook = 'thread' | 'bubble' | 'ribbon';

export interface LiveRoute {
  /** Along the streets (or the straight hint when `onStreets` is false). */
  path: LngLat[];
  /** The short steps off the street at each end (a pin in a yard), drawn as dots. */
  ends: Array<[LngLat, LngLat]>;
  straight: [LngLat, LngLat];
  metres: number;
  onStreets: boolean;
}

/** The line's colours: the service's own (taxi yellow, tuktuk plum) on a dark edge and a cream casing. */
function inkFor(service: 'taxi' | 'tuktuk') {
  const s = services.light[service];
  return { line: s.fill, edge: '#2A1A0C', casing: palette.neutral[50], on: s.on };
}

/** Points to screen space for the current camera (UI thread). */
function screenPath(pts: readonly LngLat[], cam: Camera, size: Size): string {
  'worklet';
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p = project(pts[i]![1], pts[i]![0], cam, size);
    d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The pieces of the line inside the box, in screen points (Liang-Barsky per segment). */
function visiblePieces(pts: readonly LngLat[], cam: Camera, size: Size, box: Box): Array<[number, number, number, number]> {
  'worklet';
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 1; i < pts.length; i++) {
    const a = project(pts[i - 1]![1], pts[i - 1]![0], cam, size);
    const b = project(pts[i]![1], pts[i]![0], cam, size);
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const edges: Array<[number, number]> = [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]];
    let inside = true;
    for (const [pp, q] of edges) {
      if (pp === 0) {
        if (q < 0) inside = false;
      } else if (pp < 0) t0 = Math.max(t0, q / pp);
      else t1 = Math.min(t1, q / pp);
    }
    if (inside && t0 < t1) segs.push([a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1]);
  }
  return segs;
}

/** Clear of the top bar, the side buttons and the sheet. */
function labelBox(size: Size): Box {
  'worklet';
  return { x0: 56, y0: 96, x1: size.w - 56, y1: size.h - 120 };
}

/**
 * Pickup → pin along the streets, live while the map moves under the pin. `roads` are the streets
 * the map has drawn so far (kept across settles, so the pickup's streets stay known after the camera
 * left them). Without a street path (pin off the street map) a dotted straight hint shows instead.
 */
export function useLiveRoute(cam: CameraValues, from: LngLat | null, roads: readonly WalkRoad[]) {
  const graph = useMemo(() => (roads.length ? buildStreetGraph(roads) : null), [roads]);
  const [route, setRoute] = useState<LiveRoute | null>(null);
  const last = useRef(0);
  const work = (lng: number, lat: number) => {
    if (!from) return setRoute(null);
    const to: LngLat = [lng, lat];
    const r = graph ? streetRoute(graph, from, to) : null;
    if (r) setRoute({ path: r.path, ends: [[r.from, r.path[0]!], [r.path[r.path.length - 1]!, r.to]], straight: [from, to], metres: r.metres, onStreets: true });
    else setRoute({ path: [from, to], ends: [], straight: [from, to], metres: Math.hypot((to[0] - from[0]) * 93_400, (to[1] - from[1]) * 110_540) * 1.3, onStreets: false });
  };
  const workRef = useRef(work);
  workRef.current = work;
  const live = (lng: number, lat: number) => {
    const now = Date.now();
    if (now - last.current < LIVE_ROUTE_MS) return;
    last.current = now;
    workRef.current(lng, lat);
  };
  useAnimatedReaction(
    () => ({ lng: cam.lng.value, lat: cam.lat.value }),
    (c) => runOnJS(live)(c.lng, c.lat),
  );
  // A new street map or pickup: work it out at once for where the pin is.
  useEffect(() => {
    workRef.current(cam.lng.value, cam.lat.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, from?.[0], from?.[1]]);
  return route;
}

export function RouteToPin({
  cam,
  size,
  route,
  look,
  service,
  moving,
  kmLabel,
  mLabel,
  bubbleLabel,
}: {
  cam: CameraValues;
  size: SharedValue<Size>;
  route: LiveRoute | null;
  look: RouteLook;
  service: 'taxi' | 'tuktuk';
  moving: boolean;
  kmLabel: (km: string) => string;
  mLabel: (m: string) => string;
  /** The "bubble" look: the pin's own words («نزّلني هنا») beside the distance. */
  bubbleLabel?: string;
}) {
  const theme = useTheme();
  const ink = inkFor(service);
  const pts = useSharedValue<LngLat[]>([]);
  const ends = useSharedValue<Array<[LngLat, LngLat]>>([]);
  const straightPts = useSharedValue<LngLat[]>([]);
  useEffect(() => {
    pts.value = route?.path ?? [];
    ends.value = route?.ends ?? [];
    straightPts.value = route?.straight ?? [];
  }, [route, pts, ends, straightPts]);
  // The one-time draw when the pin settles (the "bubble" look: dotted while moving, the streets when it lands).
  const draw = useSharedValue(1);
  useEffect(() => {
    if (look !== 'bubble') return;
    if (moving) {
      cancelAnimation(draw);
      draw.value = 0;
    } else draw.value = theme.reduceMotion ? 1 : withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
  }, [look, moving, draw, theme.reduceMotion]);

  const d = useAnimatedProps(() => ({ d: screenPath(pts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value) }));
  const dEnds = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    let out = '';
    for (const e of ends.value) out += screenPath(e, c, size.value);
    return { d: out };
  });
  const dStraight = useAnimatedProps(() => ({ d: screenPath(straightPts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value) }));
  // Ribbon text: along the part on screen, flipped when it runs right to left so it reads upright.
  const textD = useAnimatedProps(() => {
    const segs = visiblePieces(pts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value, labelBox(size.value));
    if (!segs.length) return { d: '' };
    const flip = segs[segs.length - 1]![2] < segs[0]![0];
    const list = flip ? segs.slice().reverse().map(([ax, ay, bx, by]) => [bx, by, ax, ay]) : segs;
    let d = '';
    for (let i = 0; i < list.length; i++) {
      const [ax, ay, bx, by] = list[i]!;
      d += `${i === 0 ? 'M' : 'L'}${ax!.toFixed(1)} ${ay!.toFixed(1)}L${bx!.toFixed(1)} ${by!.toFixed(1)}`;
    }
    return { d };
  });
  const drawn = useAnimatedProps(() => ({ d: screenPath(pts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value), strokeDashoffset: (1 - draw.value) * 4000 }));

  const words = route ? distanceWords(route.metres) : null;
  const distance = words ? (words.unit === 'km' ? kmLabel(words.value) : mLabel(words.value)) : '';
  // The distance sits halfway along the part of the line on screen (clear of the top bar and the sheet).
  const chipStyle = useAnimatedStyle(() => {
    const segs = visiblePieces(pts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value, labelBox(size.value));
    let total = 0;
    for (const [ax, ay, bx, by] of segs) total += Math.hypot(bx - ax, by - ay);
    if (total < 60) return { opacity: 0 };
    let left = total / 2;
    for (const [ax, ay, bx, by] of segs) {
      const len = Math.hypot(bx - ax, by - ay);
      if (left <= len) {
        const k = len === 0 ? 0 : left / len;
        return { opacity: 1, transform: [{ translateX: ax + (bx - ax) * k }, { translateY: ay + (by - ay) * k }] };
      }
      left -= len;
    }
    return { opacity: 0 };
  });

  if (!route) return null;
  const straight = !route.onStreets;
  const W = look === 'ribbon' ? 17 : look === 'thread' ? 7 : 5;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="ride-route">
      <Svg width="100%" height="100%">
        {straight ? (
          <>
            <AnimatedPath animatedProps={dStraight} stroke={withAlpha(ink.casing, 0.95)} strokeWidth={9} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" />
            <AnimatedPath animatedProps={dStraight} stroke={ink.edge} strokeWidth={5} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" />
          </>
        ) : (
          <>
            <AnimatedPath animatedProps={dEnds} stroke={ink.casing} strokeWidth={6} strokeLinecap="round" strokeDasharray="0.1 8" fill="none" />
            <AnimatedPath animatedProps={dEnds} stroke={ink.edge} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 8" fill="none" />
            <AnimatedPath animatedProps={d} stroke={withAlpha(palette.neutral[1000], 0.14)} strokeWidth={W + 8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.casing} strokeWidth={W + 5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.edge} strokeWidth={W + 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {look === 'bubble' ? (
              <AnimatedPath animatedProps={drawn} stroke={ink.line} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4000 4000" fill="none" />
            ) : (
              <AnimatedPath animatedProps={d} stroke={ink.line} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            )}
            {look === 'ribbon' ? (
              <>
                <Defs>
                  <AnimatedPath id="ride-route-text" animatedProps={textD} fill="none" />
                </Defs>
                <SvgText fill={ink.on} fontSize={12} fontWeight="700" fontFamily="IBMPlexSansArabic_700Bold" dy={4} letterSpacing={0.2}>
                  <TextPath href="#ride-route-text" startOffset="50%" textAnchor="middle">
                    {distance}
                  </TextPath>
                </SvgText>
              </>
            ) : null}
          </>
        )}
      </Svg>
      {look === 'bubble' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: '50%', alignItems: 'center', marginTop: -(52 + 36 + 46) }}>
          <View testID="ride-route-distance" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 38, borderRadius: 13, backgroundColor: palette.neutral[900], shadowColor: palette.neutral[1000], shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
            {bubbleLabel && !moving ? (
              <Text variant="label" weight={700} numberOfLines={1} style={{ color: palette.neutral[50] }}>
                {bubbleLabel}
              </Text>
            ) : null}
            <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 8, backgroundColor: ink.line, justifyContent: 'center' }}>
              <Text variant="caption" weight={700} tabular numberOfLines={1} style={{ color: ink.on }}>
                {distance}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      {look === 'thread' ? (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, chipStyle]}>
          <View style={{ transform: [{ translateX: -40 }, { translateY: -15 }], width: 80, alignItems: 'center' }}>
            <View testID="ride-route-distance" style={{ height: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: palette.neutral[900], borderWidth: 2, borderColor: ink.line, justifyContent: 'center', shadowColor: palette.neutral[1000], shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
              <Text variant="caption" weight={700} tabular numberOfLines={1} style={{ color: palette.neutral[50] }}>
                {distance}
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * «أنت هنا»: where the phone is, a saffron dot in a cream ring that breathes slowly (a live position),
 * still with reduce-motion. Drawn under the centre pin.
 */
export function MeDot({ cam, size, at }: { cam: CameraValues; size: SharedValue<Size>; at: LatLngPoint }) {
  const theme = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    p.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [p, theme.reduceMotion]);
  const place = useAnimatedStyle(() => {
    const q = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: q.x - 40 }, { translateY: q.y - 40 }] };
  }, [at.lat, at.lng]);
  const halo = useAnimatedStyle(() => ({ opacity: theme.reduceMotion ? 0 : 0.7 * (1 - p.value), transform: [{ scale: 0.35 + p.value * 0.65 }] }));
  const accent = palette.primary[500];
  return (
    <Animated.View pointerEvents="none" testID="ride-me-dot" style={[{ position: 'absolute', left: 0, top: 0, width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }, place]}>
      {/* A soft disc that stays (where the phone is, roughly), and a ring that breathes out from it. */}
      <View style={{ position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: withAlpha(accent, 0.2) }} />
      <Animated.View style={[{ position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 2.5, borderColor: accent, backgroundColor: withAlpha(accent, 0.18) }, halo]} />
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: palette.neutral[50], alignItems: 'center', justifyContent: 'center', shadowColor: palette.neutral[1000], shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: accent, borderWidth: 1, borderColor: withAlpha(palette.neutral[900], 0.35) }} />
      </View>
    </Animated.View>
  );
}

/** The pickup, small, where the line starts (step 2: the big pin is the destination now). */
export function FromDot({ cam, size, at }: { cam: CameraValues; size: SharedValue<Size>; at: LatLngPoint }) {
  const place = useAnimatedStyle(() => {
    const q = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: q.x - 11 }, { translateY: q.y - 11 }] };
  }, [at.lat, at.lng]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.neutral[50], alignItems: 'center', justifyContent: 'center', shadowColor: palette.neutral[1000], shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, place]}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: palette.success[500] }} />
    </Animated.View>
  );
}
