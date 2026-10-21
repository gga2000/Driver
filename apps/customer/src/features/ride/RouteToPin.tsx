import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { color as palette, services } from '@driver/design-tokens';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { project, type Camera, type LngLat as LatLngPoint, type Size } from '@/features/track/geo';
import type { CameraValues } from '@/features/track/map/types';
import { buildStreetGraph, distanceWords, streetRoute, type LngLat, type StreetGraph } from './street-route';
import type { WalkRoad } from './walk-stop';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** How often the route is worked out again while the pin moves (a street corner a frame is plenty). */
const LIVE_ROUTE_MS = 70;

export interface LiveRoute {
  /** Along the streets (or the straight hint when `onStreets` is false). */
  path: LngLat[];
  /** The short steps off the street at each end (a pin in a yard), drawn as dots. */
  ends: Array<[LngLat, LngLat]>;
  metres: number;
  onStreets: boolean;
}

/** The line's colours: the service's own (taxi yellow, tuktuk plum) on a dark edge and a cream casing. */
function inkFor(service: 'taxi' | 'tuktuk') {
  const s = services.light[service];
  return { line: s.fill, edge: '#2A1A0C', casing: palette.neutral[50] };
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

/** Where the tag may sit: clear of the top bar, the side buttons and the sheet. */
export interface TagInsets {
  top: number;
  bottom: number;
  side: number;
}

const PIN_STEP_INSETS: TagInsets = { top: 96, bottom: 120, side: 56 };

function labelBox(size: Size, inset: TagInsets): Box {
  'worklet';
  return { x0: inset.side, y0: inset.top, x1: size.w - inset.side, y1: size.h - inset.bottom };
}

/** Streets kept across settles, so the router knows them after the camera left them. */
const MAX_ROADS = 1_500;

/**
 * Every street the map has drawn in this visit (BaseMap's `onRoads`), oldest dropped first past
 * MAX_ROADS so a long visit around town keeps the router small.
 */
export function useKeptRoads(): [WalkRoad[], (rs: WalkRoad[]) => void] {
  const [roads, setRoads] = useState<WalkRoad[]>([]);
  const seenRoads = useRef(new Map<string, WalkRoad>());
  const addRoads = (rs: WalkRoad[]) => {
    const seen = seenRoads.current;
    let fresh = 0;
    for (const r of rs) {
      const a = r.coords[0], b = r.coords[r.coords.length - 1];
      const k = `${r.coords.length}:${a?.[0].toFixed(6)},${a?.[1].toFixed(6)}:${b?.[0].toFixed(6)},${b?.[1].toFixed(6)}`;
      if (seen.has(k)) continue;
      seen.set(k, r);
      fresh++;
    }
    if (!fresh) return;
    for (const k of seen.keys()) {
      if (seen.size <= MAX_ROADS) break;
      seen.delete(k);
    }
    setRoads([...seen.values()]);
  };
  return [roads, addRoads];
}

/** The way from one point to another: along the streets when the drawn streets join them, else the straight hint. */
function routeBetween(graph: StreetGraph | null, from: LngLat, to: LngLat): LiveRoute {
  const r = graph ? streetRoute(graph, from, to) : null;
  if (r) return { path: r.path, ends: [[r.from, r.path[0]!], [r.path[r.path.length - 1]!, r.to]], metres: r.metres, onStreets: true };
  return { path: [from, to], ends: [], metres: Math.hypot((to[0] - from[0]) * 93_400, (to[1] - from[1]) * 110_540) * 1.3, onStreets: false };
}

/** The same line between two fixed points (the choose screen: pickup and destination both set). */
export function useFixedRoute(from: LngLat | null, to: LngLat | null, roads: readonly WalkRoad[]): LiveRoute | null {
  const graph = useMemo(() => (roads.length ? buildStreetGraph(roads) : null), [roads]);
  const [fx, fy, tx, ty] = [from?.[0], from?.[1], to?.[0], to?.[1]];
  return useMemo(
    () => (fx === undefined || fy === undefined || tx === undefined || ty === undefined ? null : routeBetween(graph, [fx, fy], [tx, ty])),
    [graph, fx, fy, tx, ty],
  );
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
    setRoute(routeBetween(graph, from, [lng, lat]));
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
  service,
  kmLabel,
  mLabel,
  insets = PIN_STEP_INSETS,
  shortTagBy,
  showTag = true,
}: {
  cam: CameraValues;
  size: SharedValue<Size>;
  route: LiveRoute | null;
  service: 'taxi' | 'tuktuk';
  kmLabel: (km: string) => string;
  mLabel: (m: string) => string;
  insets?: TagInsets;
  /** A map with both ends fixed (the choose screen): a short line's tag sits beside this point, not the centre pin. */
  shortTagBy?: LatLngPoint;
  /** Off while something else has the reader's eye (the choose screen's walk to the stop). */
  showTag?: boolean;
}) {
  const ink = inkFor(service);
  const pts = useSharedValue<LngLat[]>([]);
  const ends = useSharedValue<Array<[LngLat, LngLat]>>([]);
  useEffect(() => {
    // Off the streets the path is the straight hint itself.
    pts.value = route?.path ?? [];
    ends.value = route?.ends ?? [];
  }, [route, pts, ends]);
  const d = useAnimatedProps(() => ({ d: screenPath(pts.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value) }));
  const dEnds = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    let out = '';
    for (const e of ends.value) out += screenPath(e, c, size.value);
    return { d: out };
  });

  const words = route ? distanceWords(route.metres) : null;
  const distance = words ? (words.unit === 'km' ? kmLabel(words.value) : mLabel(words.value)) : '';
  // The distance sits halfway along the part of the line on screen (clear of the top bar and the sheet).
  const chipStyle = useAnimatedStyle(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const segs = visiblePieces(pts.value, c, size.value, labelBox(size.value, insets));
    let total = 0;
    for (const [ax, ay, bx, by] of segs) total += Math.hypot(bx - ax, by - ay);
    // Too little of the line on screen (a short trip, or the pin over the pickup): the tag waits beside the pin head.
    if (total < 60) {
      if (!shortTagBy) return { opacity: 1, transform: [{ translateX: size.value.w / 2 + 62 }, { translateY: size.value.h / 2 - 70 }] };
      const q = project(shortTagBy.lat, shortTagBy.lng, c, size.value);
      return { opacity: 1, transform: [{ translateX: q.x + 62 }, { translateY: q.y - 56 }] };
    }
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
  }, [insets.top, insets.bottom, insets.side, shortTagBy?.lat, shortTagBy?.lng]);

  if (!route) return null;
  const straight = !route.onStreets;
  const W = 7;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="ride-route">
      <Svg width="100%" height="100%">
        {straight ? (
          <>
            <AnimatedPath animatedProps={d} stroke={withAlpha(ink.casing, 0.95)} strokeWidth={9} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.edge} strokeWidth={5} strokeLinecap="round" strokeDasharray="0.1 14" fill="none" />
          </>
        ) : (
          <>
            <AnimatedPath animatedProps={dEnds} stroke={ink.casing} strokeWidth={6} strokeLinecap="round" strokeDasharray="0.1 8" fill="none" />
            <AnimatedPath animatedProps={dEnds} stroke={ink.edge} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 8" fill="none" />
            <AnimatedPath animatedProps={d} stroke={withAlpha(palette.neutral[1000], 0.14)} strokeWidth={W + 8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.casing} strokeWidth={W + 5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.edge} strokeWidth={W + 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <AnimatedPath animatedProps={d} stroke={ink.line} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </>
        )}
      </Svg>
      {showTag ? (
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
