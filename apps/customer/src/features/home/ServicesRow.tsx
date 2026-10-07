import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { AZIZIYAH_ZONES, type IntercityDirection, type LatLng, type LaunchService } from '@driver/contracts';
import { lift, type ServiceSwatch } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';
import { CornerFill, DishDrawing, DotHalo, DownFill, Icon, MeshFill, Skeleton, STAR_TILE, StarPattern, Text, useDriftClock, useNetwork, useTheme, withAlpha, type IconName } from '@driver/ui';
import { boardSummary, clockLabel, PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useBoard } from '@/features/rajaa/queries';
import { useNearestMinutes } from '@/features/ride/queries';
import { useT } from '@/lib/i18n';
import { selectedPlace, useProfile, type SavedPlace } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { useAmbient } from './ambient';
import { backFact, rideFact, soonNames, tripsFact, type Fact } from './service-facts';
import { MOMENT_LEAD_MS, MOMENT_MS, nudge, starsX, steamWisp, taxiX, tuktukHop } from './tile-moments';

/** `trips`: Baghdad and Kut (leaving Aziziyah); `rajaa`: الرجعة, the way back (Ali, 2026-10-07). */
export type ServiceId = 'food' | 'taxi' | 'tuktuk' | 'trips' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: listed in the quiet «جاي بالطريق» card, opens the "خبرني" sheet (audit C-03). */
  soon?: boolean;
}

/** The live services, food first (spec §1: food-led), then the coming-soon ones. */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'food', label: 'home.service_food', icon: 'food' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'taxi' },
  { id: 'tuktuk', label: 'home.service_tuktuk', icon: 'tuktuk-fringe' },
  { id: 'trips', label: 'home.service_trips', icon: 'rajaa' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'arrow-back' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart', soon: true },
  { id: 'khat', label: 'home.service_khat', icon: 'clock', soon: true },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel', soon: true },
];

const def = (id: ServiceId): ServiceDef => SERVICES.find((s) => s.id === id)!;

/** The bento's measures (Date & Saffron v3, at phone size). */
const GAP = 10;
const SMALL_H = 96;
const TRIP_H = 84;
const FOOD_ART = 104;
/** The food drawing floats: it moves this share of the page's scroll more slowly, at most `FLOAT_MAX` px. */
const FLOAT = 0.18;
const FLOAT_MAX = 26;
/** Scrolled this far, the tiles are well off the top of the screen: the food tile's light stops drifting. */
const DRIFT_AWAY = 640;

/** A tile's moment (`tile-moments.ts`): its progress, and `play` to run it from the start. */
function useMoment() {
  const theme = useTheme();
  const a = useSharedValue(0);
  const play = useCallback(() => {
    if (theme.reduceMotion) return;
    a.value = 0;
    a.value = withTiming(1, { duration: MOMENT_MS, easing: Easing.linear });
  }, [a, theme.reduceMotion]);
  return { a, play };
}

/** Where home asks for the nearest free car: the deliver-to place's pin, else its zone's centre. */
export function homePin(place: SavedPlace | null): LatLng | null {
  if (!place) return null;
  if (place.pin) return place.pin;
  const z = AZIZIYAH_ZONES.find((x) => x.id === place.zoneId);
  return z ? { lat: z.lat, lng: z.lng } : null;
}

/** The next car on the main corridor's board in one direction, as "12:15". */
function useNextCar(direction: IntercityDirection, enabled: boolean) {
  const board = useBoard({ corridorId: PRIMARY_CORRIDOR, direction }, { poll: false });
  const next = board.data ? boardSummary(board.data.departures, new Date()).next : null;
  return { loading: enabled && board.isPending, error: board.isError, nextAt: next ? clockLabel(next.departAt) : null };
}

/**
 * The services on home as the Date & Saffron bento (Ali, 2026-10-06; v3 artifact), on a warm dot halo:
 * أكل the tall saffron-gradient tile (its light slowly drifting) with a dish breaking out of its
 * corner, تكسي in yellow and تكتك in plum beside it, then بغداد والكوت wide in date brown with gold
 * Iraqi star lines and its next car in a gold chip, and الرجعة (the way back) smaller in gold on its
 * left (Ali, 2026-10-07: the trips' own colours, no blue). Each tile glows in its own colour and
 * shows one live fact from the server. Offline the ride tiles turn grey and say they need the
 * internet; with every kitchen closed the food tile goes quiet. The coming-soon services are in
 * `ComingSoonStrip` at the end.
 */
export function ServicesRow({ onPress, foodFact, foodOff, scrollY }: { onPress: (id: ServiceId) => void; foodFact: Fact | null; foodOff: boolean; scrollY?: SharedValue<number> }) {
  const theme = useTheme();
  const t = useT();
  const s = theme.services;
  const online = useNetwork().online;
  const signedIn = useSignedIn();
  const pin = homePin(selectedPlace(useProfile()));
  const taxi = useNearestMinutes(online ? pin : null, 'taxi');
  const tuktuk = useNearestMinutes(online ? pin : null, 'tuktuk');
  const out = useNextCar('from_aziziyah', signedIn);
  const back = useNextCar('to_aziziyah', signedIn);
  const ridesOff = !online;
  const facts = {
    taxi: rideFact('taxi', { online, signedIn, loading: taxi.loading, nearestMinutes: taxi.minutes }),
    tuktuk: rideFact('tuktuk', { online, signedIn, loading: tuktuk.loading, nearestMinutes: tuktuk.minutes }),
    trips: tripsFact({ online, signedIn, ...out }),
    rajaa: backFact({ online, signedIn, ...back }),
  };
  const say = (f: Fact | null) => (f ? t(f.key, f.params) : null);
  // The food tile's saffron drifts (Ali's Yes, "mesh") while it can be seen.
  const [away, setAway] = useState(false);
  useAnimatedReaction(
    () => (scrollY ? scrollY.value > DRIFT_AWAY : false),
    (now, was) => {
      if (now !== was) runOnJS(setAway)(now);
    },
  );
  const drift = useDriftClock(useAmbient() && !away && !foodOff);
  const moments = { food: useMoment(), taxi: useMoment(), tuktuk: useMoment(), trips: useMoment(), rajaa: useMoment() };
  // The tile plays its moment, then the next screen opens over it (at once under reduced motion).
  const press = (id: keyof typeof moments) => {
    theme.haptic('selection');
    moments[id].play();
    if (theme.reduceMotion) onPress(id);
    else setTimeout(() => onPress(id), MOMENT_LEAD_MS);
  };
  const end = theme.isRTL ? -1 : 1;
  const float = useAnimatedStyle(() => ({ transform: [{ translateY: scrollY ? Math.min(FLOAT_MAX, Math.max(-8, scrollY.value * FLOAT)) : 0 }, { rotate: '-14deg' }] }));
  const taxiIcon = useAnimatedStyle(() => ({ transform: [{ translateX: taxiX(moments.taxi.a.value, end) }] }));
  const tuktukIcon = useAnimatedStyle(() => {
    const h = tuktukHop(moments.tuktuk.a.value);
    return { transform: [{ translateY: h.y }, { rotate: `${h.rotate}deg` }] };
  });
  // الرجعة's arrow points to the start side (it is mirrored in RTL), and nudges that way.
  const backIcon = useAnimatedStyle(() => ({ transform: [{ translateX: nudge(moments.rajaa.a.value, -end, 10) }] }));
  const stars = useAnimatedStyle(() => ({ transform: [{ translateX: starsX(moments.trips.a.value, end, STAR_TILE) }] }));
  const chip = useAnimatedStyle(() => ({ transform: [{ translateX: nudge(moments.trips.a.value, end, 8) }] }));

  return (
    <View testID="home-services" style={{ gap: GAP }}>
      {/* The halo reaches past the tiles into the gutter and fades out before the screen's edge. */}
      <DotHalo style={{ top: -22, bottom: -22, start: -theme.space[5], end: -theme.space[5] }} />
      <View style={{ flexDirection: 'row', gap: GAP }}>
        <Tile
          id="food"
          swatch={foodOff ? s.off : s.food}
          label={t(def('food').label)}
          fact={say(foodFact)}
          style={{ flex: 1.12, height: SMALL_H * 2 + GAP }}
          onPress={() => press('food')}
        >
          {foodOff ? null : <MeshFill base={s.food.fill} mesh={s.food.mesh} clock={drift} />}
          <Animated.View pointerEvents="none" testID="service-food-art" style={[{ position: 'absolute', top: -10, end: -14, width: FOOD_ART, height: FOOD_ART, opacity: foodOff ? 0.45 : 1 }, float]}>
            <Svg width={FOOD_ART} height={FOOD_ART} viewBox="0 0 200 200">
              <G transform="translate(8 6) scale(0.92)">
                <DishDrawing kind="shawarma" look={0} line={4.5} window={false} />
              </G>
            </Svg>
            <Steam a={moments.food.a} color={withAlpha(s.food.on, 0.6)} />
          </Animated.View>
          <TileBody icon={def('food').icon} swatch={foodOff ? s.off : s.food} label={t(def('food').label)} fact={say(foodFact)} big />
        </Tile>
        <View style={{ flex: 1, gap: GAP }}>
          <Tile id="taxi" swatch={ridesOff ? s.off : s.taxi} label={t(def('taxi').label)} fact={say(facts.taxi)} disabled={ridesOff} style={{ height: SMALL_H }} onPress={() => press('taxi')}>
            <TileBody icon={def('taxi').icon} iconStyle={taxiIcon} swatch={ridesOff ? s.off : s.taxi} label={t(def('taxi').label)} fact={say(facts.taxi)} />
          </Tile>
          <Tile id="tuktuk" swatch={ridesOff ? s.off : s.tuktuk} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} disabled={ridesOff} style={{ height: SMALL_H }} onPress={() => press('tuktuk')}>
            <TileBody icon={def('tuktuk').icon} iconStyle={tuktukIcon} swatch={ridesOff ? s.off : s.tuktuk} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} />
          </Tile>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        <Tile id="trips" swatch={ridesOff ? s.off : s.trips} label={t(def('trips').label)} fact={say(facts.trips)} disabled={ridesOff} style={{ flex: 1.75, height: TRIP_H }} onPress={() => press('trips')}>
          {ridesOff ? null : <CornerFill base={s.trips.fill} light={s.trips.light} />}
          {ridesOff ? null : (
            // One tile wider on each side, so gliding by a whole tile never shows an edge.
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: -STAR_TILE, end: -STAR_TILE }, stars]}>
              <StarPattern color={s.trips.pattern} />
            </Animated.View>
          )}
          <TileBody icon={def('trips').icon} chipStyle={chip} swatch={ridesOff ? s.off : s.trips} label={t(def('trips').label)} fact={say(facts.trips)} live={facts.trips?.key === 'home.trips_next'} row />
        </Tile>
        <Tile id="rajaa" swatch={ridesOff ? s.off : s.back} label={t(def('rajaa').label)} fact={say(facts.rajaa)} disabled={ridesOff} style={{ flex: 1, height: TRIP_H }} onPress={() => press('rajaa')}>
          {ridesOff ? null : <DownFill top={s.back.light} bottom={s.back.fill} />}
          <TileBody icon={def('rajaa').icon} iconStyle={backIcon} swatch={ridesOff ? s.off : s.back} label={t(def('rajaa').label)} fact={say(facts.rajaa)} compact />
        </Tile>
      </View>
    </View>
  );
}

/** One tile: its glow outside, its fill and decoration clipped inside. */
function Tile({
  id,
  swatch,
  label,
  fact,
  disabled,
  style,
  onPress,
  children,
}: {
  id: ServiceId;
  swatch: ServiceSwatch;
  label: string;
  fact: string | null;
  disabled?: boolean;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const g = lift.glowOffset;
  const glow = disabled || swatch === theme.services.off || theme.scheme !== 'light' ? undefined : `${g.x}px ${g.y}px ${g.blur}px ${g.spread}px ${withAlpha(swatch.glow, lift.glowAlpha)}`;
  // The soft spring press (Ali's Yes, "press"): the tile sinks and its glow tightens under it, then
  // both spring back with one small overshoot when the finger lifts.
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.04 * p.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: 1 - 0.4 * p.value, transform: [{ scale: 1 - 0.06 * p.value }] }));
  return (
    <Animated.View style={[{ borderRadius: theme.radius.tile }, style, sink]}>
      {glow ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.tile, backgroundColor: swatch.fill, boxShadow: glow }, halo]} /> : null}
      <Pressable
        testID={`service-${id}`}
        accessibilityRole="button"
        accessibilityLabel={fact ? `${label}، ${fact}` : label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          if (!theme.reduceMotion) p.value = withSpring(1, theme.motion.spring.press);
        }}
        onPressOut={() => {
          p.value = withSpring(0, theme.motion.spring.select);
        }}
        style={{ flex: 1, borderRadius: theme.radius.tile, backgroundColor: swatch.fill, overflow: 'hidden' }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** Three curls of steam over the food tile's dish (its moment): drawn on the dish's own 200 grid. */
const STEAM_D = ['M78 70c-9-11 9-15 0-27', 'M100 64c-9-11 9-15 0-27', 'M122 70c-9-11 9-15 0-27'] as const;

function Steam({ a, color }: { a: SharedValue<number>; color: string }) {
  return (
    <>
      {STEAM_D.map((d, i) => (
        <SteamCurl key={d} d={d} i={i} a={a} color={color} />
      ))}
    </>
  );
}

function SteamCurl({ d, i, a, color }: { d: string; i: number; a: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const w = steamWisp(a.value, i);
    return { opacity: w.opacity, transform: [{ translateY: w.y }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 200">
        <Path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/**
 * Icon, name and live fact; `big` for أكل, `row` for the wide trips tile (name and fact only),
 * `compact` for الرجعة. `live` puts the fact in a chip with a dot (the trips tile's next car, in gold).
 */
function TileBody({
  icon,
  iconStyle,
  chipStyle,
  swatch,
  label,
  fact,
  live,
  big,
  row,
  compact,
}: {
  icon: IconName;
  /** The icon's part in the tile's moment. */
  iconStyle?: AnimatedViewStyle;
  /** The live chip's part in the tile's moment. */
  chipStyle?: AnimatedViewStyle;
  swatch: ServiceSwatch;
  label: string;
  fact: string | null;
  live?: boolean;
  big?: boolean;
  row?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const sub = swatch.sub ?? swatch.on;
  const factText = fact ? (
    <Text variant={compact ? 'caption' : 'footnote'} weight={600} color={sub} numberOfLines={1} tabular style={{ flexShrink: 1 }}>
      {fact}
    </Text>
  ) : null;
  const words = (
    <View style={{ gap: live ? 4 : 0, flex: row ? 1 : undefined, flexShrink: 1, minWidth: 0, alignItems: 'flex-start' }}>
      <Text variant={big ? 'display' : compact ? 'bodyStrong' : 'title'} face="display" color={swatch.on} numberOfLines={1}>
        {label}
      </Text>
      {fact && live ? (
        <Animated.View testID="service-live" style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.md, backgroundColor: withAlpha(sub, 0.16) }, chipStyle]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: sub, boxShadow: `0px 0px 0px 3px ${withAlpha(sub, 0.3)}` }} />
          {factText}
        </Animated.View>
      ) : fact ? (
        factText
      ) : (
        // The shimmer takes the fact line's own height, so the tile doesn't shift when the fact arrives.
        <View style={{ height: theme.type[compact ? 'caption' : 'footnote'].lineHeight, justifyContent: 'center', alignSelf: 'stretch' }}>
          <Skeleton height={10} width="70%" style={{ opacity: 0.5 }} />
        </View>
      )}
    </View>
  );
  if (row) {
    // No icon: the name and the next car's chip get the whole width (the trips artifact's tile).
    return <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space[4] }}>{words}</View>;
  }
  return (
    <View style={{ flex: 1, justifyContent: 'space-between', padding: compact ? 10 : big ? theme.space[4] : theme.space[3] }}>
      <Animated.View style={[{ alignSelf: 'flex-start' }, iconStyle]}>
        <Icon name={icon} size={big ? 28 : compact ? 18 : 24} color={swatch.on} strokeWidth={1.9} />
      </Animated.View>
      {words}
    </View>
  );
}

/**
 * «جاي بالطريق»: the services that aren't open yet, quiet at the end of home (discovery §6) as one
 * dashed card — their icons, «جاي بالطريق», «سوق، خطوط وطرود» and «خبّرني لمن تنفتح». Each icon opens the
 * "خبرني" sheet.
 */
export function ComingSoonStrip({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  const soon = SERVICES.filter((s) => s.soon);
  return (
    <View
      testID="home-soon"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.space[1] }}>
        {soon.map((s) => (
          <Pressable
            key={s.id}
            testID={`service-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('soon.a11y', { name: t(s.label) })}
            onPress={() => {
              theme.haptic('selection');
              onPress(s.id);
            }}
            style={({ pressed }) => ({
              width: theme.hitTarget,
              height: theme.hitTarget,
              borderRadius: theme.radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.border : theme.colors.accentTint,
            })}
          >
            <Icon name={s.icon} size={20} color="accentText" strokeWidth={2} />
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" accessibilityRole="header" numberOfLines={1}>
          {t('home.soon_coming')}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {soonNames(soon.map((s) => t(s.label)), t)}
        </Text>
        <Text variant="footnote" weight={600} color="accentText" numberOfLines={1}>
          {t('home.soon_notify')}
        </Text>
      </View>
    </View>
  );
}
