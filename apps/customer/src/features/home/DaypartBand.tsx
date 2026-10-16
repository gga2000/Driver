import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { CatalogSearchDish } from '@driver/contracts';
import { lift } from '@driver/design-tokens';
import { AnimatedPressable, Icon, stageOf, Text, useMotionPresets, usePressScale, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { measure, type Rect } from '@/features/food/FlyToCart';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { BAND_MAX_DISHES, BAND_MIN_DISHES } from './daypart';

export interface BandBasket {
  /** How many of this dish are in the basket (0 when the basket is another kitchen's). */
  countOf: (d: CatalogSearchDish) => number;
  /** One more: `from` is the dish picture's window rectangle, where the flight to the basket starts. */
  add: (d: CatalogSearchDish, from: Rect | null) => void;
  remove: (d: CatalogSearchDish) => void;
}

/**
 * «وقت العزيزية» band (joy h1, idea 4-1): a title for the hour («للفطور», «للغدا اليوم»…) over up to
 * three real dishes from kitchens open now, as Date & Saffron dish cards in a row that runs to the
 * screen's edge: the dish on its own coloured plate, the name, the price in Alexandria and the kitchen.
 * With a `basket` (home), the saffron + on the plate's corner adds a dish with nothing to choose in one
 * tap (Ali's Yes, "addfly", 2026-10-07): it opens into − 1 + and the dish flies into the basket bar.
 * A dish that needs a choice (a size, by the kilo), or a band without a basket (search), opens the
 * dish on its kitchen's menu instead. Fewer than two dishes and the band is not drawn at all: a thin,
 * odd row is worse than none.
 */
export function DaypartBand({ title, dishes, basket, testID = 'home-daypart' }: { title: string; dishes: readonly CatalogSearchDish[] | undefined; basket?: BandBasket; testID?: string }) {
  const theme = useTheme();
  const presets = useMotionPresets();
  const shown = (dishes ?? []).slice(0, BAND_MAX_DISHES);
  if (shown.length < BAND_MIN_DISHES) return null;
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader big title={title} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -theme.space[5] }}
        // Room under the cards for their lift, at both ends for the gutter.
        contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[3], gap: theme.space[3] }}
      >
        {shown.map((d, i) => (
          <Animated.View key={d.id} entering={presets.panelIn(presets.staggerDelay(i))} style={{ width: CARD_W }}>
            <DishCard d={d} count={basket?.countOf(d) ?? 0} basket={basket} testID={`${testID}-${i}`} />
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

/** A dish card's width: two and a bit show on a 390 phone, so the row reads as one to scroll. */
const CARD_W = 148;
const STAGE_H = 104;
/** The + and the counter's keys are drawn 32 px; their tap areas are the full 44. */
export const KEY = 32;
/** The counter open: − on the start side, the count, + on the end side. */
const COUNTER_W = KEY * 3;

function DishCard({ d, count, basket, testID }: { d: CatalogSearchDish; count: number; basket: BandBasket | undefined; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const stage = useRef<View>(null);
  const press = usePressScale(0.97);
  const price = iqd(d.priceIqd, { locale });
  const open = () => {
    theme.haptic('selection');
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };
  const add = () => {
    if (!basket || !d.quickAdd || !d.available) return open();
    void measure(stage).then((from) => basket.add(d, from));
  };
  return (
    <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, boxShadow: theme.scheme === 'light' ? lift.card : undefined }}>
      <AnimatedPressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('home.band_dish_a11y', { dish: d.name, restaurant: d.restaurantName, price })}
        onPress={open}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[{ padding: theme.space[2], gap: 2 }, press.style]}
      >
        <View ref={stage} collapsable={false} style={{ height: STAGE_H, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt {...artOf(d)} photoUrl={d.photoUrl} stage={stageOf(d.id, theme.decor.stages)} />
        </View>
        <Text variant="label" weight={700} numberOfLines={1} style={{ marginTop: theme.space[1] }}>
          {d.name}
        </Text>
        <Text variant="label" face="display" numberOfLines={1}>
          {price}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {d.restaurantName}
        </Text>
      </AnimatedPressable>
      <Counter dish={d.name} count={count} onAdd={add} onRemove={() => basket?.remove(d)} testID={testID} />
    </View>
  );
}

/**
 * The saffron + on the plate's bottom end corner; with the dish in the basket it springs open into
 * − n + (the count pops on each change). Keys are 32 px with 44 px tap areas. `place` puts it on
 * another picture (home's dish grid): its top and end inside the card.
 *
 * It opens by moving, not by resizing (speed audit m2, 2026-10-07: a width animation lays the card out
 * again on every frame): the pill slides out from behind a fixed rounded window while the keys inside
 * slide back by the same amount, so they stay put and only the saffron grows. The lift under it fades
 * from the closed shape to the open one.
 */
export function Counter({ dish, count, onAdd, onRemove, testID, place }: { dish: string; count: number; onAdd: () => void; onRemove: () => void; testID: string; place?: { top: number; end: number } }) {
  const theme = useTheme();
  const t = useT();
  const dir = theme.isRTL ? -1 : 1;
  const opened = count > 0;
  const w = useSharedValue(opened ? COUNTER_W : KEY);
  const pop = useSharedValue(1);
  const last = useRef(count);
  useEffect(() => {
    const target = opened ? COUNTER_W : KEY;
    w.value = theme.reduceMotion ? target : withSpring(target, theme.motion.spring.select);
    if (count !== last.current && count > 0 && !theme.reduceMotion) {
      pop.value = withSequence(withTiming(1.25, { duration: theme.motion.duration.instant }), withSpring(1, theme.motion.spring.select));
    }
    last.current = count;
  }, [opened, count, w, pop, theme.reduceMotion, theme.motion]);
  // How far open, 0 (just the +) to 1 (− n +); the spring may overshoot a little either way.
  const open = useDerivedValue(() => (w.value - KEY) / (COUNTER_W - KEY));
  // The pill is pushed toward the end by what is still closed; the keys are pulled back by the same.
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: dir * (COUNTER_W - w.value) }] }));
  const keys = useAnimatedStyle(() => ({ transform: [{ translateX: -dir * (COUNTER_W - w.value) }] }));
  const closedLift = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, 1 - open.value)) }));
  const openLift = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, open.value)) }));
  const num = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: Math.max(0, open.value) }));
  const slop = (theme.hitTarget - KEY) / 2;
  const key = (pressed: boolean) => ({ width: KEY, height: KEY, alignItems: 'center' as const, justifyContent: 'center' as const, opacity: pressed ? 0.7 : 1 });
  const at = { position: 'absolute' as const, end: place?.end ?? theme.space[2] + 6, top: place?.top ?? theme.space[2] + STAGE_H - KEY - 6, height: KEY, borderRadius: KEY / 2 };
  return (
    <>
      {theme.scheme === 'light' ? (
        <>
          {/* Shadow only, no fill: the closed + and the open pill, crossfaded as it opens. */}
          <Animated.View pointerEvents="none" style={[at, { width: KEY, boxShadow: lift.card }, closedLift]} />
          <Animated.View pointerEvents="none" style={[at, { width: COUNTER_W, boxShadow: lift.card }, openLift]} />
        </>
      ) : null}
      {/* The fixed window: its end is the pill's end, and the pill's start slides in from there. Only
          the keys take taps, so the plate under the closed window still opens the dish. */}
      <View pointerEvents="box-none" style={[at, { width: COUNTER_W, overflow: 'hidden' }]}>
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: 0, start: 0, width: COUNTER_W, height: KEY, borderRadius: KEY / 2, backgroundColor: theme.colors.accent, overflow: 'hidden' }, pill]}>
          {/* Laid out from the end, so the closed pill shows only the +. */}
          <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', end: 0, top: 0, width: COUNTER_W, height: KEY, flexDirection: 'row', alignItems: 'center' }, keys]}>
            <Pressable
              testID={`${testID}-less`}
              accessibilityRole="button"
              accessibilityLabel={t('home.dish_less_a11y', { dish })}
              accessibilityElementsHidden={!opened}
              importantForAccessibility={opened ? 'auto' : 'no-hide-descendants'}
              disabled={!opened}
              hitSlop={{ top: slop, bottom: slop }}
              onPress={() => {
                theme.haptic('selection');
                onRemove();
              }}
              style={({ pressed }) => key(pressed)}
            >
              <Icon name="minus" size={16} color="onAccent" strokeWidth={2.6} />
            </Pressable>
            <Animated.View style={[{ width: KEY, alignItems: 'center' }, num]} accessibilityElementsHidden={!opened}>
              <Text variant="label" face="display" weight={700} color="onAccent" tabular testID={`${testID}-count`} accessibilityLabel={`${t('restaurant.qty_label', { name: dish })} ${count}`}>
                {count}
              </Text>
            </Animated.View>
            <Pressable
              testID={`${testID}-add`}
              accessibilityRole="button"
              accessibilityLabel={t('home.dish_add_a11y', { dish })}
              hitSlop={opened ? { top: slop, bottom: slop } : slop}
              onPress={onAdd}
              style={({ pressed }) => key(pressed)}
            >
              <Icon name="plus" size={18} color="onAccent" strokeWidth={2.6} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
    </>
  );
}
