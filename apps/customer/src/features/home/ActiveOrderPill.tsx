import { router } from 'expo-router';
import { useEffect, useId, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Order } from '@driver/contracts';
import { cityParts, formatClock } from '@driver/i18n';
import { AnimatedPressable, Icon, RollingDigits, Text, useDriftClock, useMotionPresets, useNow, usePressScale, useTheme, withAlpha } from '@driver/ui';
import { liveEta } from '@/features/track/eta';
import { useTracking } from '@/features/track/queries';
import { useT } from '@/lib/i18n';
import { useAmbient } from './ambient';
import { LIVE_SEGMENTS, liveProgress, liveStatusKey, newerRead } from './live-card';

/** The courier marker on the bar (drawn 22 px; the card itself is the tap target). */
const MARKER = 22;
const SEG_GAP = 4;
const SEG_H = 5;
/** The light that runs along the filled bar: its width, how long one run takes, and how often it runs (s). */
const SHEEN_W = 44;
const SHEEN_RUN = 1.1;
const SHEEN_EVERY = 3.2;
/** The live dot's ring: one pulse this often (s; the timeline's own pulse). */
const PULSE_S = 1.4;

/**
 * The order or ride in progress (spec §1), as the Istikan inverse card (joy S2-11, report 5 §5 A):
 * ink, a tea live dot, «مطعم خالد · دا يتحضّر», «طلبك يوصل» and the arrival time large in Alexandria
 * on the end side, then a 4-step bar with the courier riding on it toward the door (Date & Saffron:
 * a date-brown card). The time is the live estimate the tracking screen uses (kitchen ready time +
 * the ride to the door), else the promised time; none is shown until one is known. Opens the live
 * screen.
 *
 * It is alive (Ali's Yes votes, home effects, 2026-10-07): the dot pulses and a light runs along the
 * bar ("liveride"); the courier glides to where the order is now and, once on the way, creeps toward
 * the house as the time nears; a changed arrival time rolls its digits ("flip"); a new step makes the
 * card glow saffron for a moment while the new line slides in ("statusglow"). The loops run only while
 * home is in front; under reduced motion everything simply shows where it is.
 */
export function ActiveOrderPill({ order }: { order: Order }) {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const press = usePressScale(0.985);
  const track = useTracking(order.id);
  const now = useNow(true, 30_000);
  const v = track.data;
  // Home's list and the tracking read refresh on their own clocks: follow whichever is further along,
  // and re-read the tracking (its arrival time) when the list moves on first.
  const o = newerRead(order, v?.order.id === order.id ? v.order : null);
  const refetch = track.refetch;
  useEffect(() => {
    void refetch();
  }, [order.state, refetch]);
  const isRide = o.type === 'ride';
  const eta = v ? (liveEta(v, null, new Date(now)) ?? v.promisedAt) : null;
  const status = t(liveStatusKey(o));
  const line = v?.merchant ? t('home.live_line', { name: v.merchant.name, status }) : status;
  const progress = liveProgress(o, eta, now);
  const title = isRide ? t('home.active_trip') : eta ? t('home.live_arrives') : t('home.active_order');
  const c = theme.colors;
  const clock = useDriftClock(useAmbient());

  // A new step: the card glows for a moment and the new line rises in (never on the first look).
  const lastState = useRef(o.state);
  const changed = lastState.current !== o.state;
  const glow = useSharedValue(0);
  useEffect(() => {
    if (lastState.current === o.state) return;
    lastState.current = o.state;
    if (theme.reduceMotion) return;
    glow.value = withSequence(withTiming(1, { duration: theme.motion.duration.base }), withDelay(700, withTiming(0, { duration: 900, easing: Easing.out(Easing.quad) })));
  }, [o.state, glow, theme.reduceMotion, theme.motion.duration.base]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.xl, backgroundColor: c.inverse, boxShadow: `0px 0px 22px 4px ${withAlpha(c.accent, 0.6)}` }, glowStyle]}
      />
      <AnimatedPressable
        testID="home-active-order"
        accessibilityRole="button"
        accessibilityLabel={[title, line, eta ? formatClock(eta) : null].filter(Boolean).join('، ')}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
        style={[{ backgroundColor: c.inverse, borderRadius: theme.radius.xl, padding: theme.space[4], gap: theme.space[3] }, press.style]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <LiveDot clock={clock} color={c.accent} />
              <Animated.View key={o.state} entering={changed ? presets.panelIn(theme.motion.duration.fast) : undefined} style={{ flexShrink: 1 }}>
                <Text variant="footnote" weight={600} color="onInverseAccent" numberOfLines={1} testID="home-active-line">
                  {line}
                </Text>
              </Animated.View>
            </View>
            <Text variant="title" weight={700} color="onInverse" numberOfLines={1}>
              {title}
            </Text>
          </View>
          {eta ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }} testID="home-active-eta">
              <RollingDigits value={formatClock(eta, { period: false })} variant="numeralHero" face="display" color="onInverse" testID="home-active-eta-digits" />
              <Text variant="label" weight={600} color="onInverseMuted">
                {t(cityParts(eta).hour < 12 ? 'time.am' : 'time.pm')}
              </Text>
            </View>
          ) : (
            <Icon name="chevron-forward" size={20} color="onInverseMuted" />
          )}
        </View>
        <RideBar progress={progress} clock={clock} isRide={isRide} />
      </AnimatedPressable>
    </View>
  );
}

/** The tea dot with a ring that keeps spreading out from it and fading. */
function LiveDot({ clock, color }: { clock: SharedValue<number>; color: string }) {
  const ring = useAnimatedStyle(() => {
    const p = (clock.value % PULSE_S) / PULSE_S;
    return { opacity: 0.55 * (1 - p), transform: [{ scale: 1 + 1.6 * p }] };
  });
  return (
    <View style={{ width: 10, height: 10 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 5, backgroundColor: color }, ring]} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, borderWidth: 2, borderColor: withAlpha(color, 0.35) }} />
    </View>
  );
}

/** The four segments, filled as far as the order has come, the light running along them, the courier on them and the door at the end. */
function RideBar({ progress, clock, isRide }: { progress: number; clock: SharedValue<number>; isRide: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  const dir = theme.isRTL ? -1 : 1;
  const width = useSharedValue(0);
  const p = useSharedValue(progress);
  useEffect(() => {
    p.value = theme.reduceMotion ? progress : withSpring(progress, theme.motion.spring.sheet);
  }, [progress, p, theme.reduceMotion, theme.motion.spring.sheet]);
  const marker = useAnimatedStyle(() => {
    const x = Math.min(Math.max(p.value * width.value - MARKER / 2, 0), Math.max(0, width.value - MARKER));
    return { opacity: width.value > 0 ? 1 : 0, transform: [{ translateX: dir * x }] };
  });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
        }}
        style={{ flex: 1, justifyContent: 'center', minHeight: MARKER + 2 }}
        testID="home-active-bar"
      >
        <View style={{ flexDirection: 'row', gap: SEG_GAP }}>
          {Array.from({ length: LIVE_SEGMENTS }, (_, i) => (
            <Segment key={i} i={i} p={p} width={width} clock={clock} />
          ))}
        </View>
        <Animated.View
          testID="home-active-marker"
          style={[
            {
              position: 'absolute',
              start: 0,
              width: MARKER,
              height: MARKER,
              borderRadius: MARKER / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.onInverseAccent,
              borderWidth: 3,
              borderColor: c.inverse,
            },
            marker,
          ]}
        >
          <Icon name={isRide ? 'car' : 'bike'} size={12} color="inverse" strokeWidth={2.4} />
        </Animated.View>
      </View>
      {/* Where it is all going: the door for food, the pin for a ride. */}
      <Icon name={isRide ? 'map-pin' : 'home'} size={16} color="onInverseMuted" strokeWidth={2.2} />
    </View>
  );
}

/** One segment: its track, its fill (part-filled while the order is in it) and its share of the running light. */
function Segment({ i, p, width, clock }: { i: number; p: SharedValue<number>; width: SharedValue<number>; clock: SharedValue<number> }) {
  const theme = useTheme();
  const c = theme.colors;
  const dir = theme.isRTL ? -1 : 1;
  // The web shares one id space across every SVG on the page.
  const id = `sheen${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fill = useAnimatedStyle(() => ({ width: `${Math.min(1, Math.max(0, p.value * LIVE_SEGMENTS - i)) * 100}%` }));
  const sheen = useAnimatedStyle(() => {
    const seg = (width.value - SEG_GAP * (LIVE_SEGMENTS - 1)) / LIVE_SEGMENTS;
    const filled = p.value * LIVE_SEGMENTS;
    const whole = Math.floor(filled);
    const lead = whole * (seg + SEG_GAP) + (filled - whole) * seg;
    const run = (clock.value % SHEEN_EVERY) / SHEEN_RUN;
    // Where the light is along the whole bar, then where that falls inside this segment.
    const x = run >= 1 ? -SHEEN_W : -SHEEN_W + run * (lead + SHEEN_W);
    return { transform: [{ translateX: dir * (x - i * (seg + SEG_GAP)) }] };
  });
  return (
    <View style={{ flex: 1, height: SEG_H, borderRadius: 3, backgroundColor: withAlpha(c.onInverseMuted, 0.3), overflow: 'hidden' }}>
      <Animated.View style={[{ height: SEG_H, borderRadius: 3, backgroundColor: c.accent, overflow: 'hidden' }, fill]}>
        <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width: SHEEN_W, height: SEG_H }, sheen]}>
          <Svg width={SHEEN_W} height={SEG_H}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={c.onInverse} stopOpacity={0} />
                <Stop offset="0.5" stopColor={c.onInverse} stopOpacity={0.7} />
                <Stop offset="1" stopColor={c.onInverse} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width={SHEEN_W} height={SEG_H} fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
