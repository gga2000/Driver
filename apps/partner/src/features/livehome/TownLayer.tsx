import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, ZoomIn, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { PartnerTownPulse, TownKitchen } from '@driver/contracts/town-pulse';
import { color as palette } from '@driver/design-tokens';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import type { CameraValues } from '@/features/map/base/types';
import { pathD, project, type LngLat, type Size } from '@/features/map/geo';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { coinSides, justReady, newRipples, RIPPLE_MS, type DayStop, type Ripple } from './pulse-logic';

/**
 * «المدينة حيّة» drawn on the driver's map (Ali, 2026-10-22: A + C, with a soft B). Kitchens near him
 * as small bubbles (a ring that fills in quarter steps while cooking, saffron «جاهز» when food waits),
 * a ring and «طلب جديد» rising where an area got new orders, a faint count of drivers per part of
 * town, and his own day («يومي») as straight saffron lines with a money chip at each door. Every
 * motion plays once per change; with reduce-motion nothing moves.
 */
export const TownLayer = memo(function TownLayer({ cam, size, pulse, day }: { cam: CameraValues; size: SharedValue<Size>; pulse: PartnerTownPulse | null; day: readonly DayStop[] | null }) {
  const ripples = useRipples(pulse);
  const prevKitchens = useRef<PartnerTownPulse['kitchens'] | null>(null);
  const [popped, setPopped] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!pulse) return;
    setPopped(justReady(prevKitchens.current, pulse.kitchens));
    prevKitchens.current = pulse.kitchens;
  }, [pulse]);

  const sides = useMemo(() => (day ? coinSides(day) : []), [day]);
  if (day) {
    // «يومي» is his story: the town's live bits step aside so the trail reads.
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="live-day-layer">
        <DayLines cam={cam} size={size} stops={day} />
        {day.map((s, i) => (s.pickup ? <BagDot key={`p-${s.tripId}`} cam={cam} size={size} at={s.pickup} index={i} /> : null))}
        {day.map((s, i) => (s.dropoff ? <CoinChip key={`d-${s.tripId}`} cam={cam} size={size} at={s.dropoff} iqd={s.earnedIqd} index={i} below={sides[i] === 'below'} /> : null))}
      </View>
    );
  }
  if (!pulse) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="live-town-layer">
      {pulse.drivers.map((d) => (
        <DriverCell key={`${d.at.lat.toFixed(4)},${d.at.lng.toFixed(4)}`} cam={cam} size={size} at={d.at} n={d.n} />
      ))}
      {ripples.map((r) => (
        <RippleMark key={r.key} cam={cam} size={size} ripple={r} />
      ))}
      {pulse.kitchens.map((k) => (
        <KitchenBubble key={k.id} cam={cam} size={size} kitchen={k} pop={popped.has(k.id)} />
      ))}
    </View>
  );
});

/** Ripples from each new picture; each one leaves after `RIPPLE_MS`. */
function useRipples(pulse: PartnerTownPulse | null): Ripple[] {
  const prev = useRef<PartnerTownPulse['areas'] | null>(null);
  const [live, setLive] = useState<Ripple[]>([]);
  const at = pulse?.at.getTime() ?? 0;
  useEffect(() => {
    if (!pulse) return;
    const fresh = newRipples(prev.current, pulse.areas, at);
    prev.current = pulse.areas;
    if (fresh.length === 0) return;
    setLive((l) => [...l, ...fresh]);
    const keys = new Set(fresh.map((r) => r.key));
    const id = setTimeout(() => setLive((l) => l.filter((r) => !keys.has(r.key))), RIPPLE_MS);
    return () => clearTimeout(id);
    // One run per picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return live;
}

interface Placed {
  cam: CameraValues;
  size: SharedValue<Size>;
}

/** A box of `w`×`h` whose centre sits on `at` (`dy` lifts it so a tip lands on the spot). */
function usePlace({ cam, size }: Placed, at: LngLat, w: number, h: number, dy = 0) {
  return useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - w / 2 }, { translateY: p.y - h / 2 - dy }] };
  }, [at.lat, at.lng, w, h, dy]);
}

const BUBBLE = 34;
const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const KITCHEN_BOX = { w: 96, h: 64 };

/** A kitchen: a pot ring that fills in quarters while cooking; saffron with «جاهز» when food waits for its driver. */
function KitchenBubble({ cam, size, kitchen, pop }: Placed & { kitchen: TownKitchen; pop: boolean }) {
  const theme = useTheme();
  const t = useT();
  const ready = kitchen.state === 'ready';
  // The bubble's foot sits on the shop; the box is taller so «جاهز» fits over it.
  const place = usePlace({ cam, size }, kitchen.at, KITCHEN_BOX.w, KITCHEN_BOX.h, KITCHEN_BOX.h / 2 - BUBBLE / 2 - 2);
  const breathe = useSharedValue(1);
  useEffect(() => {
    if (!pop || theme.reduceMotion) return;
    breathe.value = withSequence(withTiming(1.18, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 420 }));
  }, [pop, theme.reduceMotion, breathe]);
  const scale = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));
  const progress = kitchen.progress ?? 0;
  const fill = ready ? theme.colors.accent : theme.colors.surface;
  return (
    <Animated.View
      testID={`live-kitchen-${kitchen.state}`}
      entering={theme.reduceMotion ? undefined : FadeIn.duration(400)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(300)}
      accessible
      accessibilityLabel={t(ready ? 'partner.live_ready_a11y' : 'partner.live_cooking_a11y')}
      style={[
        styles.anchor,
        {
          width: KITCHEN_BOX.w,
          height: KITCHEN_BOX.h,
          alignItems: 'center',
          justifyContent: 'flex-end',
        },
        place,
      ]}
    >
      {ready ? (
        <View style={{ marginBottom: 3, paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: 'center', backgroundColor: theme.colors.text }}>
          <Text variant="caption" weight={700} color="surface" style={{ fontSize: 11, lineHeight: 15 }}>
            {t('partner.live_ready')}
          </Text>
        </View>
      ) : null}
      <Animated.View
        style={[
          {
            width: BUBBLE,
            height: BUBBLE,
            borderRadius: BUBBLE / 2,
            backgroundColor: fill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: ready ? 2 : 0,
            borderColor: theme.colors.surface,
            ...shadow,
          },
          scale,
        ]}
      >
        {!ready ? (
          <Svg width={BUBBLE} height={BUBBLE} style={StyleSheet.absoluteFill}>
            <Circle cx={BUBBLE / 2} cy={BUBBLE / 2} r={RING_R} stroke={theme.colors.border} strokeWidth={3} fill="none" />
            {progress > 0 ? (
              <Circle
                cx={BUBBLE / 2}
                cy={BUBBLE / 2}
                r={RING_R}
                stroke={theme.colors.accent}
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${RING_C * progress} ${RING_C}`}
                transform={`rotate(-90 ${BUBBLE / 2} ${BUBBLE / 2})`}
              />
            ) : null}
          </Svg>
        ) : null}
        <Icon name={ready ? 'bag' : 'flame'} size={16} color={ready ? 'onAccent' : 'accentText'} strokeWidth={2.2} />
      </Animated.View>
    </Animated.View>
  );
}

const RIPPLE = 96;

/** New orders in an area: one soft ring that widens twice and a «طلب جديد» chip, then both fade. Never on a house. */
function RippleMark({ cam, size, ripple }: Placed & { ripple: Ripple }) {
  const theme = useTheme();
  const t = useT();
  const place = usePlace({ cam, size }, ripple.at, RIPPLE, RIPPLE);
  const wave = useSharedValue(theme.reduceMotion ? 0.6 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    wave.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), 2, false);
  }, [theme.reduceMotion, wave]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - wave.value), transform: [{ scale: 0.25 + wave.value * 0.75 }] }));
  return (
    <Animated.View testID="live-ripple" entering={FadeIn.duration(200)} exiting={FadeOut.duration(500)} style={[styles.anchor, { width: RIPPLE, height: RIPPLE, alignItems: 'center', justifyContent: 'center' }, place]}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: RIPPLE,
            height: RIPPLE,
            borderRadius: RIPPLE / 2,
            borderWidth: 2,
            borderColor: theme.colors.accent,
            backgroundColor: withAlpha(theme.colors.accent, 0.12),
          },
          ring,
        ]}
      />
      <Animated.View
        entering={theme.reduceMotion ? undefined : ZoomIn.duration(260).delay(120)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1.5, borderColor: theme.colors.accent, direction: 'rtl', ...shadow }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent }} />
        <Text variant="caption" weight={700} style={{ fontSize: 11, lineHeight: 15 }}>
          {t('partner.live_new_order')}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const CELL = 64;
/** The box is wider than the disc so «12 سايق» never wraps. */
const CELL_W = 112;

/** Drivers in a part of town: a faint disc and a small «4 سواق» tag. A count only, never a dot per driver. */
function DriverCell({ cam, size, at, n }: Placed & { at: LngLat; n: number }) {
  const theme = useTheme();
  const t = useT();
  const place = usePlace({ cam, size }, at, CELL_W, CELL);
  return (
    <Animated.View testID="live-drivers" entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)} style={[styles.anchor, { width: CELL_W, height: CELL, alignItems: 'center', justifyContent: 'center' }, place]}>
      <View style={{ position: 'absolute', left: (CELL_W - CELL) / 2, width: CELL, height: CELL, borderRadius: CELL / 2, backgroundColor: withAlpha(theme.colors.text, 0.06) }} />
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: withAlpha(theme.colors.surface, 0.92), borderWidth: 1, borderColor: theme.colors.border, direction: 'rtl' }}
      >
        <Icon name="bike" size={12} color="textMuted" strokeWidth={2} />
        <Text variant="caption" weight={600} color="textMuted" tabular numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {t(n > 10 ? 'partner.live_drivers_many' : 'partner.live_drivers', { n })}
        </Text>
      </View>
    </Animated.View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** His day: each pickup to its door as a straight saffron line (honest: we don't have his exact streets). */
function DayLines({ cam, size, stops }: Placed & { stops: readonly DayStop[] }) {
  const theme = useTheme();
  const draw = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    draw.value = withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) });
  }, [theme.reduceMotion, draw]);
  const legs = useMemo(() => stops.filter((s) => s.pickup && s.dropoff).map((s) => [s.pickup!, s.dropoff!] as const), [stops]);
  const props = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const d = legs
      .map(([a, b]) => {
        const p = project(a.lat, a.lng, c, size.value);
        const q = project(b.lat, b.lng, c, size.value);
        // The line grows from the kitchen toward the door once.
        return pathD([p, { x: p.x + (q.x - p.x) * draw.value, y: p.y + (q.y - p.y) * draw.value }]);
      })
      .join(' ');
    return { d };
  }, [legs]);
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <AnimatedPath animatedProps={props} stroke={theme.scheme === 'dark' ? palette.neutral[1000] : palette.neutral[0]} strokeWidth={8} strokeLinecap="round" fill="none" strokeOpacity={0.85} />
      <AnimatedPath animatedProps={props} stroke={theme.colors.accent} strokeWidth={4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

const DOT = 22;

function BagDot({ cam, size, at, index }: Placed & { at: LngLat; index: number }) {
  const theme = useTheme();
  const place = usePlace({ cam, size }, at, DOT, DOT);
  return (
    <Animated.View
      testID="live-day-pickup"
      entering={theme.reduceMotion ? undefined : FadeIn.duration(300).delay(index * 120)}
      style={[
        styles.anchor,
        {
          width: DOT,
          height: DOT,
          borderRadius: DOT / 2,
          backgroundColor: theme.colors.surface,
          borderWidth: 2,
          borderColor: theme.colors.text,
          alignItems: 'center',
          justifyContent: 'center',
        },
        place,
      ]}
    >
      <Icon name="bag" size={11} color="text" strokeWidth={2.4} />
    </Animated.View>
  );
}

const COIN = { w: 110, h: 30 };

/** «+2,000 دينار» where he delivered, popping in one after another the first time «يومي» opens. */
function CoinChip({ cam, size, at, iqd, index, below }: Placed & { at: LngLat; iqd: number; index: number; below: boolean }) {
  const theme = useTheme();
  const t = useT();
  const place = usePlace({ cam, size }, at, COIN.w, COIN.h, below ? -(COIN.h / 2 + 4) : COIN.h / 2 + 4);
  const delay = 900 + index * 160;
  const lift = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    lift.value = withDelay(delay, withTiming(1, { duration: 320, easing: Easing.out(Easing.back(1.6)) }));
  }, [theme.reduceMotion, lift, delay]);
  const pop = useAnimatedStyle(() => ({ opacity: lift.value, transform: [{ scale: 0.6 + 0.4 * lift.value }] }));
  return (
    <Animated.View testID="live-day-coin" style={[styles.anchor, { width: COIN.w, height: COIN.h, alignItems: 'center', justifyContent: 'center' }, place]}>
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 9,
            height: 26,
            borderRadius: 13,
            backgroundColor: theme.colors.accent,
            borderWidth: 2,
            borderColor: theme.colors.surface,
            direction: 'rtl',
            ...shadow,
          },
          pop,
        ]}
      >
        <Icon name="cash" size={13} color="onAccent" strokeWidth={2.2} />
        <Text variant="caption" weight={700} color="onAccent" tabular style={{ fontSize: 12, lineHeight: 16 }}>
          {t('partner.live_coin', { amount: amountParam(iqd, { sign: true }) })}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const shadow = {
  shadowColor: palette.neutral[1000],
  shadowOpacity: 0.16,
  shadowRadius: 5,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
};

const styles = StyleSheet.create({ anchor: { position: 'absolute', left: 0, top: 0 } });
