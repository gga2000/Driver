import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Icon, LocalPhoto, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { AMBIENT_PLAY_MS, useAmbient } from './ambient';
import { Dots } from './DishGallery';
import { settleSlide, tourDwellMs, tourPlan } from './gallery';
import { mapBoxHeight, mapCards, type MapCard } from './map-box';

export { mapBoxNight } from './map-box';

export interface MapBoxProps {
  night: boolean;
  /** The live line on the drawn town: «8 فاتحين هسة», or when they open. */
  fact: string;
  /** The page's scroll; the box must be a direct child of the page, so its layout is page-relative. */
  scrollY: SharedValue<number>;
  width: number;
}

/** Space between cards while one slides in over the other. */
const GAP = 12;
/** One step of the turn: slow enough to read as a card moving, not a jump. */
const GLIDE_MS = 700;
/** A press this soon after a swipe ended is the swipe's own release, not a tap. */
const SWIPE_CLICK_MS = 350;

const openMap = () => router.push('/restaurant-map');

/**
 * «مطاعم العزيزية على الخريطة» under the kitchens: the way into the restaurant map as cards that turn.
 * The first is the town drawn in the dark date of the trips card, its kitchens' saffron pins landing
 * once, with the live «8 فاتحين هسة»; then three real shops from the 3D map (golden by day, lit at
 * night), each with its own line. Like the dish gallery above it: it swipes, and once it is on screen
 * it shows the set by itself one time and comes back to the drawn town, then holds still. A swipe or a
 * tap stops the turn for good; with reduced motion nothing moves alone. Every card opens the map. The
 * pictures come from the API like the dish photos and load only as the box nears the screen. Website and
 * phones share it; home shows it only where the restaurant map itself runs (`GOLDEN_MAP`).
 */
export function MapBox({ night, fact, scrollY, width }: MapBoxProps) {
  const theme = useTheme();
  const t = useT();
  const { height: screenH } = useWindowDimensions();
  const cards = mapCards(night);
  const n = cards.length;
  const height = mapBoxHeight(width);
  const step = width + GAP;
  const dir = theme.isRTL ? -1 : 1;
  const reduce = theme.reduceMotion;
  const pos = useSharedValue(0);
  const from = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  const toured = useRef(0);
  const dragging = useRef(false);
  const draggedAt = useRef(0);

  // In view (most of the cards on screen) starts the pins and the turn; near (a screen away) loads the pictures.
  const [box, setBox] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const [near, setNear] = useState(false);
  const [landed, setLanded] = useState(reduce);
  useAnimatedReaction(
    () => (box == null ? 0 : scrollY.value + screenH > box + height * 0.7 && scrollY.value < box + height * 0.3 ? 2 : scrollY.value + screenH * 2 > box ? 1 : 0),
    (where, before) => {
      if (where === before) return;
      runOnJS(setInView)(where === 2);
      if (where > 0) runOnJS(setNear)(true);
      if (where === 2) runOnJS(setLanded)(true);
    },
    [box, screenH, height],
  );
  const playing = useAmbient(inView);

  const goTo = (to: number) => {
    const next = Math.max(0, Math.min(n - 1, to));
    cancelAnimation(pos);
    pos.value = reduce ? next : withTiming(next, { duration: GLIDE_MS, easing: Easing.inOut(Easing.cubic) });
    setIndex(next);
  };
  const stopTour = () => setTouched(true);
  const dragStarted = () => {
    dragging.current = true;
    stopTour();
  };
  const dragEnded = () => {
    dragging.current = false;
    draggedAt.current = Date.now();
  };
  const justDragged = () => dragging.current || Date.now() - draggedAt.current < SWIPE_CLICK_MS;

  // The one turn: each card waits, then glides to the next; the last step is the drawn town again.
  useEffect(() => {
    if (!playing || !inView || touched) return;
    const plan = tourPlan(n);
    if (toured.current >= plan.length) return;
    const id = setTimeout(() => {
      const to = plan[toured.current] ?? 0;
      toured.current += 1;
      goTo(to);
    }, tourDwellMs(n, AMBIENT_PLAY_MS - GLIDE_MS * 2));
    return () => clearTimeout(id);
    // goTo only reads the latest n and reduce, both in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, inView, touched, n, index, reduce]);

  const settled = (to: number) => {
    setIndex(to);
    theme.haptic('selection');
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onStart(() => {
      cancelAnimation(pos);
      from.value = pos.value;
      runOnJS(dragStarted)();
    })
    .onUpdate((e) => {
      const raw = from.value - (e.translationX * dir) / step;
      pos.value = raw < 0 ? raw / 3 : raw > n - 1 ? n - 1 + (raw - (n - 1)) / 3 : raw;
    })
    .onEnd((e) => {
      const to = settleSlide(pos.value, -(e.velocityX * dir) / step, n);
      pos.value = reduce ? to : withSpring(to, { damping: 22, stiffness: 190, mass: 0.9 });
      runOnJS(settled)(to);
    })
    .onFinalize((_e, ran) => {
      if (ran) runOnJS(dragEnded)();
    });

  return (
    <View testID="home-map-box" style={{ gap: theme.space[2] }} onLayout={(e) => setBox(e.nativeEvent.layout.y)}>
      <GestureDetector gesture={pan}>
        <View style={{ width, height, borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.services.trips.fill }}>
          {cards.map((c, i) => (
            <CardView
              key={c.id}
              card={c}
              i={i}
              current={i === index}
              pos={pos}
              step={step}
              dir={dir}
              width={width}
              height={height}
              fact={i === 0 ? fact : null}
              near={near}
              landed={landed}
              onOpen={() => {
                if (justDragged()) return;
                stopTour();
                theme.haptic('selection');
                openMap();
              }}
              onNext={() => {
                stopTour();
                goTo(index + 1);
              }}
              onPrev={() => {
                stopTour();
                goTo(index - 1);
              }}
              label={`${t(c.title)}، ${i === 0 ? `${fact}، ` : ''}${t(c.line)}، ${t('restaurant_map.count', { n: i + 1, total: n })}`}
            />
          ))}
        </View>
      </GestureDetector>
      <Dots
        count={n}
        pos={pos}
        dir={dir}
        onPick={(i) => {
          stopTour();
          goTo(i);
        }}
        testID="home-map-box-dot"
      />
    </View>
  );
}

function CardView({
  card,
  i,
  current,
  pos,
  step,
  dir,
  width,
  height,
  fact,
  near,
  landed,
  onOpen,
  onNext,
  onPrev,
  label,
}: {
  card: MapCard;
  i: number;
  current: boolean;
  pos: SharedValue<number>;
  step: number;
  dir: number;
  width: number;
  height: number;
  fact: string | null;
  near: boolean;
  landed: boolean;
  onOpen: () => void;
  onNext: () => void;
  onPrev: () => void;
  label: string;
}) {
  const theme = useTheme();
  const t = useT();
  const ink = theme.colors.photoBackdrop;
  const on = theme.colors.onPhotoBackdrop;
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (i - pos.value) * step * dir }] }));
  const picture = card.picture ? apiPhoto(card.picture) : null;
  return (
    <Animated.View
      style={[{ position: 'absolute', top: 0, left: 0, width, height }, slide]}
      // Only the card in view is read out; the others wait off to the side.
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!current}
    >
      <Pressable
        testID={`home-map-card-${card.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityActions={[
          { name: 'next', label: t('home.map_box_next') },
          { name: 'prev', label: t('home.map_box_prev') },
        ]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'next' ? onNext() : e.nativeEvent.actionName === 'prev' ? onPrev() : undefined)}
        onPress={onOpen}
        style={StyleSheet.absoluteFill}
      >
        {card.picture ? (
          <>
            {near && picture ? <LocalPhoto testID={`home-map-card-${card.id}-picture`} eager source={{ uri: picture }} style={{ width: '100%', height: '100%' }} /> : null}
            {/* Dark at the foot for the words; the shop clear above them. */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg width="100%" height="100%" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`map-card-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0.42" stopColor={ink} stopOpacity={0} />
                    <Stop offset="1" stopColor={ink} stopOpacity={0.88} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#map-card-${card.id})`} />
              </Svg>
            </View>
          </>
        ) : (
          <DrawnTown width={width} height={height} landed={landed} />
        )}
      </Pressable>

      {fact ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: theme.space[3],
            start: theme.space[3],
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            minHeight: 30,
            paddingHorizontal: theme.space[3],
            borderRadius: theme.radius.pill,
            backgroundColor: withAlpha(on, 0.12),
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent }} />
          <Text variant="caption" weight={700} color={on} tabular numberOfLines={1}>
            {fact}
          </Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={{ position: 'absolute', bottom: theme.space[4], start: theme.space[4], end: theme.space[4], flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text face="display" weight={700} color={on} numberOfLines={2} maxFontSizeMultiplier={1.25} style={{ fontSize: 22, lineHeight: 32 }}>
            {t(card.title)}
          </Text>
          <Text variant="footnote" weight={500} color={withAlpha(on, 0.84)} numberOfLines={2}>
            {t(card.line)}
          </Text>
        </View>
        <View style={{ width: theme.hitTarget, height: theme.hitTarget, borderRadius: theme.hitTarget / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent }}>
          <Icon name="chevron-forward" size={22} color={theme.colors.onAccent} strokeWidth={2.4} />
        </View>
      </View>
    </Animated.View>
  );
}

/** Where the drawn town's kitchens stand (fractions of the card), above the river and clear of the words. */
const PINS: readonly [number, number][] = [
  [0.2, 0.3],
  [0.34, 0.19],
  [0.47, 0.33],
  [0.6, 0.21],
  [0.73, 0.35],
  [0.86, 0.26],
];

/** The town drawn in the trips card's dark date: the Tigris bending under it, a few streets, the kitchens' pins. */
function DrawnTown({ width: W, height: H, landed }: { width: number; height: number; landed: boolean }) {
  const theme = useTheme();
  const trips = theme.services.trips;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        {/* The Tigris. */}
        <Path d={`M-10 ${H * 0.6} C ${W * 0.25} ${H * 0.44}, ${W * 0.45} ${H * 0.74}, ${W * 0.7} ${H * 0.56} S ${W * 0.95} ${H * 0.44}, ${W + 10} ${H * 0.5}`} stroke={withAlpha(trips.light, 0.95)} strokeWidth={26} fill="none" strokeLinecap="round" />
        {/* The Kut road and a few streets. */}
        <Path d={`M-10 ${H * 0.14} L ${W * 0.55} ${H * 0.26} L ${W + 10} ${H * 0.12}`} stroke={withAlpha(trips.on, 0.26)} strokeWidth={4} fill="none" strokeLinejoin="round" />
        {[0.16, 0.3, 0.44, 0.58, 0.72, 0.86].map((x) => (
          <Path key={x} d={`M ${W * x} ${H * 0.04} L ${W * (x + 0.04)} ${H * 0.5}`} stroke={withAlpha(trips.on, 0.11)} strokeWidth={2} />
        ))}
        {[0.22, 0.36].map((y) => (
          <Path key={y} d={`M ${W * 0.08} ${H * (y + 0.04)} L ${W * 0.94} ${H * y}`} stroke={withAlpha(trips.on, 0.09)} strokeWidth={2} />
        ))}
      </Svg>
      {PINS.map(([x, y], i) => (
        <Pin key={i} x={x} y={y} index={i} landed={landed} />
      ))}
    </View>
  );
}

/** A saffron pin that lands once, a beat after the one before it, when the cards first come into view. */
function Pin({ x, y, index, landed }: { x: number; y: number; index: number; landed: boolean }) {
  const theme = useTheme();
  const p = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (landed && !theme.reduceMotion) p.value = withDelay(200 + index * 130, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [index, landed, p, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * -10 }, { scale: 0.7 + 0.3 * p.value }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, marginLeft: -15, marginTop: -15 }, style]}>
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.services.trips.on }}>
        <Icon name="food" size={15} color={theme.colors.onAccent} strokeWidth={2.2} />
      </View>
    </Animated.View>
  );
}
