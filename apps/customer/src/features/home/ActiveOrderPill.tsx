import { router } from 'expo-router';
import { useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { LiveStageSwatch } from '@driver/design-tokens';
import type { Order } from '@driver/contracts';
import { cityParts, formatClock } from '@driver/i18n';
import { AnimatedPressable, CornerFill, Icon, RollingDigits, Text, useDriftClock, useMotionPresets, useNow, usePressScale, useTheme, withAlpha, type IconName } from '@driver/ui';
import { liveEta } from '@/features/track/eta';
import { useTracking } from '@/features/track/queries';
import { useT } from '@/lib/i18n';
import { useAmbient } from './ambient';
import { LIVE_SEGMENTS, STAGE_LOOK, liveProgress, liveStage, liveStatusKey, newerRead, stageEtaKey, stageTitleKey, type LiveStage } from './live-card';
import { SCENE, StageScene } from './StageScene';

/** The stage's mark riding the bar (drawn 22 px; the card itself is the tap target). */
const MARKER = 22;
const SEG_GAP = 4;
const SEG_H = 5;
/** The light that runs along the filled bar: its width, how long one run takes, and how often it runs (s). */
const SHEEN_W = 44;
const SHEEN_RUN = 1.1;
const SHEEN_EVERY = 3.2;
/** The live dot's ring: one pulse this often (s; the timeline's own pulse). */
const PULSE_S = 1.4;
/** A new stage's colour spreads out from the picture this big (px across, enough to cover the card). */
const WASH = 800;

/** What rides the bar at each stage: the slip, the kitchen's yes, the dish, the bag, the courier; a ride's search, then the car. */
const STAGE_MARK: Record<LiveStage, IconName> = {
  sent: 'receipt',
  accepted: 'check',
  cooking: 'food',
  ready: 'bag',
  onTheWay: 'bike',
  searching: 'search',
  driverComing: 'car',
  onTrip: 'car',
};

/**
 * The order or ride in progress (spec §1). Each stage has its own look (Ali, 2026-10-07: "make the
 * different stages visually different"): the card warms up as the food gets closer, from the dark of
 * a date (sent to the restaurant) through cinnamon (the kitchen said yes) and the red of strong tea
 * (cooking) to gold (ready) and saffron (on the way), each with its own little moving picture at the
 * head of the card, its own title and its own mark riding the bar (`theme.liveStages`, `StageScene`).
 * Under the restaurant's name, the stage in large type; on the end side «يوصل» over the arrival time
 * in Alexandria, the live estimate the tracking screen uses (kitchen ready time + the ride to the
 * door), else the promised time; none is shown until one is known, nor while a ride still looks for
 * its driver. Opens the live screen.
 *
 * It is alive (Ali's Yes votes, home effects, 2026-10-07): the dot pulses and a light runs along the
 * bar ("liveride"); the mark glides to where the order is now and, once on the way, creeps toward
 * the house as the time nears; a changed arrival time rolls its digits ("flip"); a new stage spreads
 * its colour out from the picture while the card glows for a moment and the new title rises in
 * ("statusglow"). The loops play for a while when home comes to the front or the order reaches a new
 * stage (`useAmbient`), then hold still; under reduced motion everything simply shows where it is.
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
  const stage = liveStage(o);
  // No time while a ride still looks for its driver: nobody is coming yet.
  const eta = v && stage !== 'searching' ? (liveEta(v, null, new Date(now)) ?? v.promisedAt) : null;
  const look = theme.liveStages[STAGE_LOOK[stage]];
  const name = v?.merchant?.name ?? t(isRide ? 'home.active_trip' : 'home.active_order');
  const title = t(stageTitleKey(stage));
  const etaWord = t(stageEtaKey(stage));
  const progress = liveProgress(o, eta, now);
  // A new stage plays its picture again for a while, then the card holds still (speed audit h1).
  const playing = useAmbient(stage);
  const clock = useDriftClock(playing);
  // The live dot's ring and the light along the bar only mean something while they move: they fade out when it rests.
  const live = useSharedValue(playing ? 1 : 0);
  useEffect(() => {
    live.value = withTiming(playing ? 1 : 0, { duration: theme.motion.duration.slow });
  }, [playing, live, theme.motion.duration.slow]);

  // The stage it came from stays painted under the new one while the new colour spreads over it.
  const [fields, setFields] = useState({ from: stage, to: stage });
  if (fields.to !== stage) setFields({ from: fields.to, to: stage });
  const from = theme.liveStages[STAGE_LOOK[fields.from]];
  const moved = fields.from !== fields.to;
  const motion = moved && !theme.reduceMotion;

  // A new stage: the card glows for a moment in the new stage's colour (never on the first look).
  const glow = useSharedValue(0);
  const lastStage = useRef(stage);
  useEffect(() => {
    if (lastStage.current === stage) return;
    lastStage.current = stage;
    if (theme.reduceMotion) return;
    glow.value = withSequence(withTiming(1, { duration: theme.motion.duration.base }), withDelay(700, withTiming(0, { duration: 900, easing: Easing.out(Easing.quad) })));
  }, [stage, glow, theme.reduceMotion, theme.motion.duration.base]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const washAt = theme.space[4] + SCENE / 2 - WASH / 2;

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.xl, backgroundColor: look.fill, boxShadow: `0px 0px 22px 4px ${withAlpha(look.glow, 0.6)}` }, glowStyle]}
      />
      <AnimatedPressable
        testID="home-active-order"
        accessibilityRole="button"
        accessibilityLabel={[name, t(liveStatusKey(o)), eta ? `${etaWord} ${formatClock(eta)}` : null].filter(Boolean).join('، ')}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
        style={[{ backgroundColor: look.fill, borderRadius: theme.radius.xl, overflow: 'hidden' }, press.style]}
      >
        <CornerFill base={from.fill} light={from.light} />
        {moved ? (
          <>
            <Animated.View
              key={`wash-${stage}`}
              pointerEvents="none"
              entering={motion ? ZoomIn.duration(theme.motion.duration.deliberate).easing(Easing.out(Easing.cubic)) : undefined}
              style={{ position: 'absolute', top: washAt, start: washAt, width: WASH, height: WASH, borderRadius: WASH / 2, backgroundColor: look.fill }}
            />
            <Animated.View
              key={`field-${stage}`}
              pointerEvents="none"
              entering={motion ? FadeIn.duration(theme.motion.duration.slow).delay(theme.motion.duration.slow) : undefined}
              style={StyleSheet.absoluteFill}
            >
              <CornerFill base={look.fill} light={look.light} />
            </Animated.View>
          </>
        ) : null}
        <View style={{ padding: theme.space[4], gap: theme.space[3] }} testID={`home-active-stage-${stage}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <StageScene stage={stage} clock={clock} plate={look.plate} arrived={motion} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <LiveDot clock={clock} live={live} color={look.accent} />
                <Text variant="footnote" weight={600} color={look.sub} numberOfLines={1} style={{ flexShrink: 1 }} testID="home-active-line">
                  {name}
                </Text>
              </View>
              <Animated.View key={stage} entering={motion ? presets.panelIn(theme.motion.duration.fast) : undefined}>
                <Text variant="title" weight={700} color={look.on} numberOfLines={1} testID="home-active-title">
                  {title}
                </Text>
              </Animated.View>
            </View>
            {eta ? (
              <View style={{ alignItems: 'flex-end' }} testID="home-active-eta">
                <Text variant="caption" weight={600} color={look.sub}>
                  {etaWord}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <RollingDigits value={formatClock(eta, { period: false })} variant="numeralHero" face="display" color={look.on} testID="home-active-eta-digits" />
                  <Text variant="label" weight={600} color={look.sub}>
                    {t(cityParts(eta).hour < 12 ? 'time.am' : 'time.pm')}
                  </Text>
                </View>
              </View>
            ) : (
              <Icon name="chevron-forward" size={20} color={look.sub} />
            )}
          </View>
          <RideBar progress={progress} clock={clock} live={live} look={look} mark={STAGE_MARK[stage]} isRide={isRide} />
        </View>
      </AnimatedPressable>
    </View>
  );
}

/** The live dot with a ring that keeps spreading out from it and fading. */
function LiveDot({ clock, live, color }: { clock: SharedValue<number>; live: SharedValue<number>; color: string }) {
  const ring = useAnimatedStyle(() => {
    const p = (clock.value % PULSE_S) / PULSE_S;
    return { opacity: 0.55 * (1 - p) * live.value, transform: [{ scale: 1 + 1.6 * p }] };
  });
  return (
    <View style={{ width: 10, height: 10 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 5, backgroundColor: color }, ring]} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, borderWidth: 2, borderColor: withAlpha(color, 0.35) }} />
    </View>
  );
}

/** The four segments, filled as far as the order has come, the light running along them, the stage's mark on them and the door at the end. */
function RideBar({ progress, clock, live, look, mark, isRide }: { progress: number; clock: SharedValue<number>; live: SharedValue<number>; look: LiveStageSwatch; mark: IconName; isRide: boolean }) {
  const theme = useTheme();
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
            <Segment key={i} i={i} p={p} width={width} clock={clock} live={live} look={look} />
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
              backgroundColor: look.marker,
              borderWidth: 3,
              borderColor: look.fill,
            },
            marker,
          ]}
        >
          <Icon name={mark} size={12} color={look.markerOn} strokeWidth={2.4} />
        </Animated.View>
      </View>
      {/* Where it is all going: the door for food, the pin for a ride. */}
      <Icon name={isRide ? 'map-pin' : 'home'} size={16} color={look.sub} strokeWidth={2.2} />
    </View>
  );
}

/**
 * One segment: its track, its fill (part-filled while the order is in it) and its share of the running
 * light. The fill is always the segment's full length and slides in from the start side, hidden by the
 * track until it gets there (speed audit m2, 2026-10-07: moving it costs nothing, resizing it lays the
 * card out again on every frame of the spring).
 */
function Segment({ i, p, width, clock, live, look }: { i: number; p: SharedValue<number>; width: SharedValue<number>; clock: SharedValue<number>; live: SharedValue<number>; look: LiveStageSwatch }) {
  const theme = useTheme();
  const dir = theme.isRTL ? -1 : 1;
  // The web shares one id space across every SVG on the page.
  const id = `sheen${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // How much of this segment is still empty, in px (the bar's width is known after its first layout).
  const empty = useDerivedValue(() => {
    const seg = (width.value - SEG_GAP * (LIVE_SEGMENTS - 1)) / LIVE_SEGMENTS;
    return (1 - Math.min(1, Math.max(0, p.value * LIVE_SEGMENTS - i))) * Math.max(0, seg);
  });
  const fill = useAnimatedStyle(() => ({ opacity: width.value > 0 ? 1 : 0, transform: [{ translateX: -dir * empty.value }] }));
  const sheen = useAnimatedStyle(() => {
    const seg = (width.value - SEG_GAP * (LIVE_SEGMENTS - 1)) / LIVE_SEGMENTS;
    const filled = p.value * LIVE_SEGMENTS;
    const whole = Math.floor(filled);
    const lead = whole * (seg + SEG_GAP) + (filled - whole) * seg;
    const run = (clock.value % SHEEN_EVERY) / SHEEN_RUN;
    // Where the light is along the whole bar, then where that falls inside this segment (the fill it
    // rides in is pulled back by what is still empty, so the light is pushed on by the same).
    const x = run >= 1 ? -SHEEN_W : -SHEEN_W + run * (lead + SHEEN_W);
    return { opacity: live.value, transform: [{ translateX: dir * (x - i * (seg + SEG_GAP) + empty.value) }] };
  });
  return (
    <View style={{ flex: 1, height: SEG_H, borderRadius: 3, backgroundColor: withAlpha(look.sub, 0.3), overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 3, backgroundColor: look.accent, overflow: 'hidden' }, fill]}>
        <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width: SHEEN_W, height: SEG_H }, sheen]}>
          <Svg width={SHEEN_W} height={SEG_H}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={look.shine} stopOpacity={0} />
                <Stop offset="0.5" stopColor={look.shine} stopOpacity={0.7} />
                <Stop offset="1" stopColor={look.shine} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect width={SHEEN_W} height={SEG_H} fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
