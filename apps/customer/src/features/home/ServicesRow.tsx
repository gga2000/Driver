import { useCallback, useEffect, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { AZIZIYAH_ZONES, type IntercityDirection, type LatLng, type LaunchService } from '@driver/contracts';
import { lift, type ServiceCard } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';
import { CornerFill, Icon, LocalPhoto, Skeleton, Text, useNetwork, useTheme, withAlpha, type IconName } from '@driver/ui';
import { boardSummary, clockLabel, PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useBoard } from '@/features/rajaa/queries';
import { useNearestMinutes } from '@/features/ride/queries';
import { useT } from '@/lib/i18n';
import { selectedPlace, useProfile, type SavedPlace } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { useAmbient } from './ambient';
import { backFact, rideFact, tripsFact, type Fact } from './service-facts';
import { MOMENT_LEAD_MS, MOMENT_MS, nudge, steamWisp, tuktukHop } from './tile-moments';
import { TILE_PICTURES, type TilePicture } from './tile-pictures';
import { grownTileHeight } from './tile-size';

/** `trips`: Baghdad and Kut (leaving Aziziyah); `rajaa`: الرجعة, the way back (Ali, 2026-10-07). */
export type ServiceId = 'food' | 'taxi' | 'tuktuk' | 'trips' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: a soft chip in the quiet «جاي قريب» line at the end of home, opens the "خبرني" sheet (audit C-03). */
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

/** The bento's measures (soft tint, at phone size and normal text; `grownTileHeight` adds large text). */
const GAP = 10;
const SMALL_H = 96;
const TRIP_H = 84;
/** How far a tile's name or fact may shrink to fit its width (phones only; the web keeps the size). */
const FIT_MIN = 0.8;
/** The food picture floats: it moves this share of the page's scroll more slowly, at most `FLOAT_MAX` px. */
const FLOAT = 0.18;
const FLOAT_MAX = 26;
/** How far a vehicle pulls forward in its tile's moment (px). */
const PULL = 12;
/** بغداد والكوت's share of the round-trip row (الرجعة has 1), and the there-and-back sign between them. */
const TRIPS_FLEX = 1.75;
const SIGN = 30;
/** The live dot, and one beat of its ring. */
const DOT = 7;
const PULSE_MS = 2400;

/**
 * Where a picture sits in its tile, as shares of the tile's width so it scales with the phone: its
 * `width`, how far it runs past the tile's `end` edge (the tile clips it), and `bottom` when it stands
 * on the tile's floor rather than in the middle. `text` is the width the name and fact keep at the start.
 */
interface Placement {
  width: DimensionValue;
  end: DimensionValue;
  bottom?: DimensionValue;
  text?: DimensionValue;
}
const PLACE = {
  food: { width: '66%', end: '-2%', bottom: '-20%' },
  taxi: { width: '62%', end: '-22%', text: '50%' },
  tuktuk: { width: '52%', end: '-8%', text: '50%' },
  trips: { width: '33%', end: '5%', bottom: '9%', text: '61%' },
  rajaa: { width: '80%', end: '-40%', bottom: '7%', text: '52%' },
} as const satisfies Record<string, Placement>;

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
 * The services on home as soft-tint cards (Ali, 2026-10-07: concept C of the home cards redesign,
 * same layout as before): each card a pale wash of its service's own colour with ink type and the
 * service's real picture, no shadow. أكل tall with the wrap rising from its floor, تكسي and تكتك
 * stacked beside it, then بغداد والكوت wide and الرجعة smaller. Each card shows one live fact from the
 * server, with a softly beating dot while it is live. Offline the ride cards turn grey and say they
 * need the internet; with every kitchen closed the food card goes quiet. The coming-soon services
 * are in `QuietEnd` at the end.
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
  // The dot marks what the server knows right now, not a card's standing description.
  const live = {
    food: !foodOff && foodFact?.key === 'home.food_open',
    taxi: facts.taxi?.key === 'home.taxi_near',
    tuktuk: facts.tuktuk?.key === 'home.tuktuk_near',
    trips: facts.trips?.key === 'home.trips_next',
    rajaa: facts.rajaa?.key === 'home.back_next',
  };
  // A number keeps the word after it on its line when a fact wraps («3 دقيقة», «2:35 ص», «4 ركاب»).
  const say = (f: Fact | null) => (f ? t(f.key, f.params).replace(/(\d) /g, '$1\u00A0') : null);
  const beat = useAmbient();
  const moments = { food: useMoment(), taxi: useMoment(), tuktuk: useMoment(), trips: useMoment(), rajaa: useMoment() };
  // The card plays its moment, then the next screen opens over it (at once under reduced motion).
  const press = (id: keyof typeof moments) => {
    theme.haptic('selection');
    moments[id].play();
    if (theme.reduceMotion) onPress(id);
    else setTimeout(() => onPress(id), MOMENT_LEAD_MS);
  };
  const end = theme.isRTL ? -1 : 1;
  // Large text: each row grows by what a card's name and two fact lines grow (`tile-size.ts`).
  const { fontScale } = useWindowDimensions();
  const lines = [theme.type.title.lineHeight, theme.type.caption.lineHeight, theme.type.caption.lineHeight];
  const smallH = grownTileHeight(SMALL_H, lines, fontScale);
  const tripH = grownTileHeight(TRIP_H, lines, fontScale);
  const float = useAnimatedStyle(() => ({ transform: [{ translateY: scrollY ? Math.min(FLOAT_MAX, Math.max(-8, scrollY.value * FLOAT)) : 0 }] }));
  // The taxi and الرجعة's car face the start side (coming for you, coming home) and pull forward;
  // the Baghdad car faces the end and pulls away; the tuktuk hops.
  const taxiPull = useAnimatedStyle(() => ({ transform: [{ translateX: nudge(moments.taxi.a.value, -end, PULL) }] }));
  const tuktukHops = useAnimatedStyle(() => {
    const h = tuktukHop(moments.tuktuk.a.value);
    return { transform: [{ translateY: h.y }, { rotate: `${h.rotate}deg` }] };
  });
  const tripsPull = useAnimatedStyle(() => ({ transform: [{ translateX: nudge(moments.trips.a.value, end, PULL) }] }));
  const backPull = useAnimatedStyle(() => ({ transform: [{ translateX: nudge(moments.rajaa.a.value, -end, PULL) }] }));
  const food = foodOff ? s.off.card : s.food.card;
  const ride = (c: ServiceCard) => (ridesOff ? s.off.card : c);

  return (
    <View testID="home-services" style={{ gap: GAP }}>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        <Tile id="food" card={food} label={t(def('food').label)} fact={say(foodFact)} style={{ flex: 1.12, height: smallH * 2 + GAP }} onPress={() => press('food')}>
          <Picture testID="service-food-art" picture={TILE_PICTURES.food} place={PLACE.food} facing="end" tilt={-9} off={foodOff} style={float}>
            <Steam a={moments.food.a} color={withAlpha(food.sub, 0.55)} />
          </Picture>
          <View style={{ padding: theme.space[4] }}>
            <Words card={food} label={t(def('food').label)} fact={say(foodFact)} live={live.food} beat={beat} big />
          </View>
        </Tile>
        <View style={{ flex: 1, gap: GAP }}>
          <Tile id="taxi" card={ride(s.taxi.card)} label={t(def('taxi').label)} fact={say(facts.taxi)} disabled={ridesOff} style={{ height: smallH }} onPress={() => press('taxi')}>
            <Picture picture={TILE_PICTURES.taxi} place={PLACE.taxi} facing="start" off={ridesOff} style={taxiPull} />
            <SideWords text={PLACE.taxi.text}>
              <Words card={ride(s.taxi.card)} label={t(def('taxi').label)} fact={say(facts.taxi)} live={live.taxi} beat={beat} />
            </SideWords>
          </Tile>
          <Tile id="tuktuk" card={ride(s.tuktuk.card)} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} disabled={ridesOff} style={{ height: smallH }} onPress={() => press('tuktuk')}>
            <Picture picture={TILE_PICTURES.tuktuk} place={PLACE.tuktuk} facing="start" off={ridesOff} style={tuktukHops} />
            <SideWords text={PLACE.tuktuk.text}>
              <Words card={ride(s.tuktuk.card)} label={t(def('tuktuk').label)} fact={say(facts.tuktuk)} live={live.tuktuk} beat={beat} />
            </SideWords>
          </Tile>
        </View>
      </View>
      {/* Out to Baghdad and Kut and back home: two cards with the there-and-back sign between them
          (Ali picked it over the torn ticket and one two-colour card, 2026-10-08). */}
      <View testID="home-round-trip" style={{ flexDirection: 'row', height: tripH }}>
        <Tile id="trips" card={ride(s.trips.card)} label={t(def('trips').label)} fact={say(facts.trips)} disabled={ridesOff} style={{ flex: TRIPS_FLEX }} onPress={() => press('trips')}>
          <Picture picture={TILE_PICTURES.intercity} place={PLACE.trips} facing="end" off={ridesOff} style={tripsPull} />
          <SideWords text={PLACE.trips.text}>
            <Words card={ride(s.trips.card)} label={t(def('trips').label)} fact={say(facts.trips)} live={live.trips} beat={beat} />
          </SideWords>
        </Tile>
        <View pointerEvents="none" style={{ width: GAP, alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <RoundTripSign card={ride(s.trips.card)} />
        </View>
        <Tile id="rajaa" card={ride(s.back.card)} label={t(def('rajaa').label)} fact={say(facts.rajaa)} disabled={ridesOff} style={{ flex: 1 }} onPress={() => press('rajaa')}>
          <Picture picture={TILE_PICTURES.van} place={PLACE.rajaa} facing="start" off={ridesOff} style={backPull} />
          <SideWords text={PLACE.rajaa.text}>
            <Words card={ride(s.back.card)} label={t(def('rajaa').label)} fact={say(facts.rajaa)} live={live.rajaa} beat={beat} />
          </SideWords>
        </Tile>
      </View>
    </View>
  );
}

/**
 * One card: its wash with the light falling on its top corner and a fine edge, the picture and words
 * clipped inside; it sinks a little under the finger.
 */
function Tile({
  id,
  card,
  label,
  fact,
  disabled,
  style,
  onPress,
  children,
}: {
  id: ServiceId;
  card: ServiceCard;
  label: string;
  fact: string | null;
  disabled?: boolean;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  // The soft spring press (Ali's Yes, "press"): the card sinks, then springs back with one small
  // overshoot when the finger lifts.
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.04 * p.value }] }));
  return (
    <Animated.View style={[style, sink]}>
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
        style={{ flex: 1, backgroundColor: card.bg, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: withAlpha(card.on, 0.07), overflow: 'hidden' }}
      >
        {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
        {children}
      </Pressable>
    </Animated.View>
  );
}

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/**
 * A card's picture at its `place`, turned to face the reading direction's `start` or `end` side
 * (mirrored when the file faces the other way). `tilt` leans it; `off` fades it with its card.
 */
function Picture({
  picture,
  place,
  facing,
  tilt,
  off,
  style,
  testID,
  children,
}: {
  picture: TilePicture;
  place: Placement;
  facing: 'start' | 'end';
  tilt?: number;
  off: boolean;
  style?: AnimatedViewStyle;
  testID?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const startSide = theme.isRTL ? 'right' : 'left';
  const side = facing === 'start' ? startSide : startSide === 'right' ? 'left' : 'right';
  const turn = [...(picture.faces !== side ? [{ scaleX: -1 }] : []), ...(tilt ? [{ rotate: `${tilt}deg` }] : [])];
  const at: ViewStyle = place.bottom !== undefined ? { bottom: place.bottom } : { top: 0, bottom: 0, justifyContent: 'center' };
  return (
    <Animated.View testID={testID} pointerEvents="none" style={[{ position: 'absolute', end: place.end, width: place.width, opacity: off ? 0.4 : 1 }, at, style]}>
      {/* The box holds the shape (an image left to size itself takes the file's own pixels on the web). Not
          `eager`: a guest's welcome screen draws home behind it for a moment, and on the web these five
          pictures then wait instead of downloading for nothing (speed w2); on home they still come at once. */}
      <View accessibilityIgnoresInvertColors style={{ width: '100%', aspectRatio: picture.aspect, transform: turn.length ? turn : undefined }}>
        <LocalPhoto source={picture.source} fit="contain" style={{ width: '100%', height: '100%' }} />
      </View>
      {children}
    </Animated.View>
  );
}

/** Three curls of steam over the wrap (the food card's moment), on a 200 × 100 grid above the picture. */
const STEAM_D = ['M70 96c-9-11 9-15 0-27', 'M100 88c-9-11 9-15 0-27', 'M130 96c-9-11 9-15 0-27'] as const;

function Steam({ a, color }: { a: SharedValue<number>; color: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: '-22%', start: '10%', width: '80%', aspectRatio: 2 }}>
      {STEAM_D.map((d, i) => (
        <SteamCurl key={d} d={d} i={i} a={a} color={color} />
      ))}
    </View>
  );
}

function SteamCurl({ d, i, a, color }: { d: string; i: number; a: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const w = steamWisp(a.value, i);
    return { opacity: w.opacity, transform: [{ translateY: w.y }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 100">
        <Path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/** The name and fact column at a card's start side, beside its picture, centred top to bottom. */
function SideWords({ text, children }: { text: DimensionValue; children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ position: 'absolute', top: 0, bottom: 0, start: theme.space[3], width: text, justifyContent: 'center' }}>{children}</View>;
}

/**
 * The there-and-back sign between بغداد والكوت and الرجعة: a small round chip over the gap with two
 * arrows going opposite ways, so the two cards read as one trip out and home again.
 */
function RoundTripSign({ card }: { card: ServiceCard }) {
  const theme = useTheme();
  return (
    <View
      testID="home-round-trip-sign"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: SIGN,
        height: SIGN,
        borderRadius: SIGN / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: withAlpha(card.on, 0.1),
        boxShadow: theme.scheme === 'light' ? lift.card : undefined,
      }}
    >
      {/* The swap mark is drawn upright; turned, its arrows run along the row. */}
      <View style={{ transform: [{ rotate: '90deg' }] }}>
        <Icon name="swap" size={15} color={card.dot} strokeWidth={2.2} />
      </View>
    </View>
  );
}

/**
 * The service's name and its live fact (two lines at most, beside a picture; one in the tall food
 * card), with the beating dot while the fact is live. A shimmer holds the fact's place while it loads.
 */
function Words({ card, label, fact, live, beat, big }: { card: ServiceCard; label: string; fact: string | null; live: boolean; beat: boolean; big?: boolean }) {
  const theme = useTheme();
  const factType = big ? 'footnote' : 'caption';
  const line = theme.type[factType].lineHeight;
  return (
    <View style={{ alignItems: 'flex-start', minWidth: 0 }}>
      <Text variant={big ? 'heading' : 'title'} face="display" color={card.on} numberOfLines={1} compact adjustsFontSizeToFit minimumFontScale={FIT_MIN}>
        {label}
      </Text>
      {fact ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, maxWidth: '100%' }}>
          {live ? <LiveDot color={card.dot} beat={beat} top={(line - DOT) / 2} /> : null}
          {/* Large text: the card grows only to the compact cap, and a long fact shrinks to fit rather than being cut. */}
          <Text variant={factType} weight={500} color={card.sub} numberOfLines={big ? 1 : 2} compact adjustsFontSizeToFit minimumFontScale={FIT_MIN} tabular style={{ flexShrink: 1 }}>
            {fact}
          </Text>
        </View>
      ) : (
        // The shimmer takes the fact line's own height, so the card doesn't shift when the fact arrives.
        <View style={{ height: line, justifyContent: 'center', alignSelf: 'stretch' }}>
          <Skeleton height={10} width="70%" style={{ opacity: 0.5 }} />
        </View>
      )}
    </View>
  );
}

/**
 * The live dot: a ring grows out of it and fades, once per beat, while home's ambient movement plays
 * (`useAmbient`). When it rests, the ring on its way out finishes spreading instead of vanishing.
 */
function LiveDot({ color, beat, top }: { color: string; beat: boolean; top: number }) {
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!beat) {
      cancelAnimation(ring);
      if (ring.value > 0 && ring.value < 1) ring.value = withTiming(1, { duration: (1 - ring.value) * PULSE_MS, easing: Easing.out(Easing.quad) });
      return;
    }
    ring.value = 0;
    ring.value = withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(ring);
  }, [beat, ring]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - ring.value), transform: [{ scale: 1 + 1.4 * ring.value }] }));
  return (
    <View testID="service-live" style={{ width: DOT, height: DOT, marginTop: top }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: DOT / 2, backgroundColor: color }, halo]} />
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color }} />
    </View>
  );
}
