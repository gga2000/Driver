import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { formatClock } from '@driver/i18n';
import { Icon, PhotoImage, Text, useTheme, withAlpha } from '@driver/ui';
import { measure } from '@/features/food/FlyToCart';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import type { FoodPhotoSource } from '@/features/food-landing/photos';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { AMBIENT_PLAY_MS, useAmbient } from './ambient';
import type { BandBasket } from './DaypartBand';
import { settleSlide, tourDwellMs, tourPlan, type HourDish } from './gallery';
import { potUntilAt } from './habits';

/** A dish's picture: the kitchen's own photo when it has one, else a real photo from the dish library (null: none). */
export interface DishPhoto {
  uri: string | null;
  local: FoodPhotoSource | null;
}

/** Space between slides while one slides in over the other. */
const GAP = 12;
/** One step of the tour: slow enough to read as a photo moving, not a jump. */
const GLIDE_MS = 700;
/** A press this soon after a swipe ended is the swipe's own release, not a tap. */
const SWIPE_CLICK_MS = 350;
/** Dot slots under the gallery: each a 28 px wide tap target holding a 6 px dot. */
const DOT_SLOT = 28;
const DOT = 6;
const DOT_ON = 20;

/** The gallery's height for a column `width`: a wide photo, never taller than a third of a phone. */
export function galleryHeight(width: number): number {
  return Math.round(Math.min(Math.max(width * 0.72, 236), 320));
}

/**
 * «طبخة الساعة» as a gallery (Ali 2026-10-08: "I like C but make it rotating like a gallery photo"):
 * the hour's pots and dishes, one big real photo at a time, each with its kitchen, minutes and price
 * and «أضيفه». It swipes like a photo gallery, and once it is on screen it shows the set by itself one
 * time (a slide every few seconds, back to the first, then still: the motion rule h1, nothing moves on
 * an idle home). A swipe or a tap stops the tour for good; with reduced motion it never moves alone.
 * Screen readers get one slide at a time with next/previous actions.
 */
export function DishGallery({
  slides,
  photos,
  minutesOf,
  width,
  visible,
  basket,
  now,
  testID = 'home-gallery',
}: {
  slides: readonly HourDish[];
  photos: readonly DishPhoto[];
  minutesOf: (kitchenId: string) => number | null;
  width: number;
  /** Most of the gallery is on screen: the tour may play. */
  visible: boolean;
  basket: BandBasket;
  now: Date;
  testID?: string;
}) {
  const theme = useTheme();
  const n = slides.length;
  const height = galleryHeight(width);
  const step = width + GAP;
  const dir = theme.isRTL ? -1 : 1;
  const reduce = theme.reduceMotion;
  const pos = useSharedValue(0);
  const from = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  const toured = useRef(0);
  // A swipe ends with a click on the web, which must not open the dish: while one runs and just after.
  const dragging = useRef(false);
  const draggedAt = useRef(0);
  // Home's 20 s of motion, started again when the gallery comes into view.
  const playing = useAmbient(visible);

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

  // The one tour: each step waits on the slide, then glides to the next; the last step is home again.
  useEffect(() => {
    if (!playing || !visible || touched || n < 2) return;
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
  }, [playing, visible, touched, n, index, reduce]);

  const settled = (to: number) => {
    setIndex(to);
    theme.haptic('selection');
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .enabled(n > 1)
    .onStart(() => {
      cancelAnimation(pos);
      from.value = pos.value;
      runOnJS(dragStarted)();
    })
    .onUpdate((e) => {
      const raw = from.value - (e.translationX * dir) / step;
      // Past either end it gives a little, like a photo pulled against the frame.
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

  if (n === 0) return null;
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <GestureDetector gesture={pan}>
        <View style={{ width, height, borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.colors.photoBackdrop }}>
          {slides.map((h, i) => (
            <Slide
              key={h.dish.id}
              h={h}
              photo={photos[i] ?? null}
              i={i}
              count={n}
              current={i === index}
              pos={pos}
              step={step}
              dir={dir}
              width={width}
              height={height}
              minutes={minutesOf(h.dish.restaurantId)}
              basket={basket}
              now={now}
              onNext={() => {
                stopTour();
                goTo(index + 1);
              }}
              onPrev={() => {
                stopTour();
                goTo(index - 1);
              }}
              onUse={stopTour}
              justDragged={justDragged}
              testID={`${testID}-${i}`}
            />
          ))}
        </View>
      </GestureDetector>
      {n > 1 ? (
        <Dots
          count={n}
          pos={pos}
          dir={dir}
          onPick={(i) => {
            stopTour();
            goTo(i);
          }}
          testID={`${testID}-dot`}
        />
      ) : null}
    </View>
  );
}

function Slide({
  h,
  photo,
  i,
  count,
  current,
  pos,
  step,
  dir,
  width,
  height,
  minutes,
  basket,
  now,
  onNext,
  onPrev,
  onUse,
  justDragged,
  testID,
}: {
  h: HourDish;
  photo: DishPhoto | null;
  i: number;
  count: number;
  current: boolean;
  pos: SharedValue<number>;
  step: number;
  dir: number;
  width: number;
  height: number;
  minutes: number | null;
  basket: BandBasket;
  now: Date;
  onNext: () => void;
  onPrev: () => void;
  onUse: () => void;
  justDragged: () => boolean;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pic = useRef<View>(null);
  const [failed, setFailed] = useState(false);
  const d = h.dish;
  const price = iqd(d.priceIqd, { locale });
  const inBasket = basket.countOf(d);
  const quick = d.quickAdd && d.available;
  const ink = theme.colors.photoBackdrop;
  const on = theme.colors.onPhotoBackdrop;
  const tag = h.pot ? [t('pots.badge'), h.pot.until ? t('pots.until', { time: formatClock(potUntilAt(h.pot.until, now)) }) : null].filter(Boolean).join(' · ') : null;
  const meta = [d.restaurantName, h.line, minutes ? t('food.minutes', { n: minutes }) : null].filter(Boolean).join(' · ');
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (i - pos.value) * step * dir }] }));
  const open = () => {
    if (justDragged()) return;
    onUse();
    theme.haptic('selection');
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };
  const add = () => {
    if (!quick) return open();
    onUse();
    void measure(pic).then((from) => basket.add(d, from));
  };
  const uri = failed ? null : photo?.uri;
  return (
    <Animated.View
      style={[{ position: 'absolute', top: 0, left: 0, width, height }, slide]}
      // Only the slide in view is read out; the others wait off to the side.
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!current}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('home.gallery_slide_a11y', { dish: d.name, restaurant: d.restaurantName, price, n: i + 1, total: count })}
        accessibilityHint={tag ?? undefined}
        accessibilityActions={count > 1 ? [{ name: 'next', label: t('home.gallery_next') }, { name: 'prev', label: t('home.gallery_prev') }] : undefined}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'next' ? onNext() : e.nativeEvent.actionName === 'prev' ? onPrev() : undefined)}
        onPress={open}
        style={StyleSheet.absoluteFill}
      >
        <View ref={pic} collapsable={false} style={StyleSheet.absoluteFill}>
          {uri ? (
            <PhotoImage uri={uri} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
          ) : photo?.local != null ? (
            <FoodPhoto photo={photo.local} style={{ width: '100%', height: '100%' }} />
          ) : null}
        </View>
        {/* Dark at the foot for the words, a breath of it at the top for the tag; the dish clear between. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={`gallery-${d.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={ink} stopOpacity={0.28} />
                <Stop offset="0.22" stopColor={ink} stopOpacity={0} />
                <Stop offset="0.45" stopColor={ink} stopOpacity={0} />
                <Stop offset="1" stopColor={ink} stopOpacity={0.9} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#gallery-${d.id})`} />
          </Svg>
        </View>
      </Pressable>

      {tag ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: theme.space[3], start: theme.space[3], paddingVertical: 5, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent }}>
          <Text variant="caption" weight={700} color="onAccent" tabular numberOfLines={1}>
            {tag}
          </Text>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], start: theme.space[4], end: theme.space[4], flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
        <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}>
          <Text face="display" weight={700} color={on} numberOfLines={2} maxFontSizeMultiplier={1.25} style={{ fontSize: 24, lineHeight: 34 }}>
            {d.name}
          </Text>
          <Text variant="footnote" color={withAlpha(on, 0.84)} numberOfLines={1} tabular>
            {meta}
          </Text>
          <Text face="display" weight={700} color={on} tabular numberOfLines={1} style={{ marginTop: 2, fontSize: 16, lineHeight: 24 }}>
            {price}
          </Text>
        </View>
        <Pressable
          testID={`${testID}-add`}
          accessibilityRole="button"
          accessibilityLabel={quick ? t('home.dish_add_a11y', { dish: d.name }) : t('home.gallery_open_a11y', { dish: d.name })}
          onPress={() => {
            theme.haptic('light');
            add();
          }}
          style={({ pressed }) => ({ minHeight: theme.hitTarget + 4, paddingHorizontal: theme.space[5], borderRadius: theme.radius.pill, flexDirection: 'row', alignItems: 'center', gap: theme.space[1], backgroundColor: theme.colors.accent, transform: [{ scale: pressed ? 0.97 : 1 }] })}
        >
          {quick ? <Icon name="plus" size={16} color="onAccent" strokeWidth={2.6} /> : null}
          <Text variant="button" weight={700} color="onAccent" tabular numberOfLines={1}>
            {!quick ? t('home.gallery_open') : inBasket > 0 ? t('home.gallery_more') : t('home.gallery_add')}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** Where the gallery is: a dot per slide, the one in view a saffron pill that slides with the photo. */
function Dots({ count, pos, dir, onPick, testID }: { count: number; pos: SharedValue<number>; dir: number; onPick: (i: number) => void; testID: string }) {
  const theme = useTheme();
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, Math.min(count - 1, pos.value)) * DOT_SLOT * dir }] }));
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ alignSelf: 'center', flexDirection: 'row', height: theme.hitTarget, alignItems: 'center' }}>
      {Array.from({ length: count }, (_, i) => (
        <Pressable key={i} testID={`${testID}-${i}`} onPress={() => onPick(i)} style={{ width: DOT_SLOT, height: theme.hitTarget, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.colors.borderStrong }} />
        </Pressable>
      ))}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', start: (DOT_SLOT - DOT_ON) / 2, top: (theme.hitTarget - DOT) / 2, width: DOT_ON, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.colors.accent }, pill]} />
    </View>
  );
}
