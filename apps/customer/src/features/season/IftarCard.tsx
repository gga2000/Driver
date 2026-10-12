import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatClock, formatMinutes } from '@driver/i18n';
import { CornerFill, Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { motifForKitchen } from '@/features/food/FoodArt';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { kitchenPhotos } from '@/features/home/dish-photos';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { ramadanKitchens, type RamadanLine } from './ramadan';

/** How many of the kitchens that make it show their photo at most, its size and how far each tucks under the last. */
const FACES = 3;
const FACE = 34;
const OVERLAP = 10;
/** The lantern string: its height, how far it sags in the middle, and one bulb about every this many px. */
const STRING_H = 22;
const SAG = 4;
const BULB_EVERY = 20;
const BULB = 6;
/** The first and last bulbs stay this far in from the sides, clear of the rounded corners. */
const INSET = 16;
/** The bulbs light one after another once, from the start side, then stay lit. */
const LIGHT_DELAY_MS = 350;
const LIGHT_STEP_MS = 45;
const LIGHT_MS = 360;

/**
 * The Ramadan strip on a festive day (home roast 3 look R3, Ali's pick 2026-10-12; map idea N2's iftar
 * line): a slim Soft Tint box in الرجعة's gold, built like «كل المحلات», with a short string of lanterns
 * along its top that lights up once. It says the time left to iftar (or until when suhoor runs) with the
 * adhan's time on the person's timetable. In the last hours before iftar (and through suhoor) it also
 * shows the open kitchens that still make it, their photos and a round arrow; then the whole strip opens
 * the open-kitchens list. With none to show it is a plain line, not a button.
 */
export function IftarCard({ line, timetable, kitchens }: { line: Exclude<RamadanLine, { kind: 'none' }>; timetable: string | null; kitchens: readonly RestaurantSummary[] }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const card = theme.services.back.card;
  const ring = card.top ?? card.bg;
  const [w, setW] = useState(0);
  const [room, setRoom] = useState<number | null>(null);
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.025 * p.value }] }));
  const iftar = line.kind === 'iftar';
  const title = `${t(iftar ? 'season.iftar_after' : 'season.suhoor_label')} ${iftar ? formatMinutes(line.minutes, { locale }) : formatClock(line.at, { locale })}`;
  const making = useMemo(() => ramadanKitchens(kitchens, line), [kitchens, line]);
  const n = making.length;
  const adhan = iftar ? t('season.adhan_at', { time: formatClock(line.at, { locale }) }) : null;
  const by = timetable ? t('season.by_timetable', { timetable }) : null;
  const count = n > 0 ? t(iftar ? 'season.strip_kitchens' : 'home.food_open', { n }) : null;
  // One short line: who makes it and the adhan; with no kitchens to show, the adhan and whose timetable.
  const sub = (count ? [count, adhan] : [adhan, by]).filter((s): s is string => s !== null).join(' · ');
  const label = [title, count, adhan, by].filter((s): s is string => s !== null).join('، ');
  const photos = useMemo(() => kitchenPhotos(making.slice(0, FACES).map((r) => motifForKitchen(r.tags, r.cuisine))), [making]);
  const faces = making
    .slice(0, FACES)
    .map((r, i) => apiPhoto(r.photoUrl) ?? photos[i] ?? null)
    .filter((f): f is string | number => f !== null);
  // The photos take the room the words leave, as many as fit whole (fewer on a small phone or with large text).
  const fit = room === null ? faces.length : Math.max(0, Math.min(faces.length, Math.floor((room - FACE) / (FACE - OVERLAP)) + 1));
  const box = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space[3],
    minHeight: 76,
    paddingTop: STRING_H + theme.space[1],
    paddingBottom: theme.space[3],
    paddingStart: theme.space[5],
    paddingEnd: n > 0 ? theme.space[4] : theme.space[5],
    backgroundColor: card.bg,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: withAlpha(card.on, 0.07),
    overflow: 'hidden' as const,
  };
  const inside = (
    <>
      {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
      <Lanterns w={w} wire={withAlpha(card.on, 0.25)} />
      <View testID={`home-season-${line.kind}`} style={{ flexShrink: 1, minWidth: 0 }}>
        <Text variant="title" face="display" color={card.on} numberOfLines={1} tabular>
          {title}
        </Text>
        {sub ? (
          <Text variant="footnote" weight={500} color={card.sub} numberOfLines={2} tabular>
            {sub}
          </Text>
        ) : null}
      </View>
      {n > 0 ? (
        <>
          <View
            testID="home-season-kitchens"
            onLayout={(e) => setRoom(e.nativeEvent.layout.width)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' }}
          >
            {faces.slice(0, fit).map((f, i) => (
              <View key={i} style={{ width: FACE, height: FACE, marginStart: i === 0 ? 0 : -OVERLAP, borderRadius: FACE / 2, borderWidth: 2, borderColor: ring, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
                <FoodPhoto photo={f} style={{ width: '100%', height: '100%' }} />
              </View>
            ))}
          </View>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: card.on }}>
            <Icon name="chevron-forward" size={20} color={ring} strokeWidth={2.25} />
          </View>
        </>
      ) : null}
    </>
  );
  if (n === 0) {
    return (
      <View testID="home-season" accessible accessibilityLabel={label} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={box}>
        {inside}
      </View>
    );
  }
  return (
    <Animated.View style={sink}>
      <Pressable
        testID="home-season"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t(iftar ? 'season.iftar_go' : 'season.suhoor_go')}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onPress={() => {
          theme.haptic('selection');
          router.push({ pathname: '/restaurants', params: { preset: 'open' } });
        }}
        onPressIn={() => {
          if (!theme.reduceMotion) p.value = withSpring(1, theme.motion.spring.press);
        }}
        onPressOut={() => {
          p.value = withSpring(0, theme.motion.spring.select);
        }}
        style={box}
      >
        {inside}
      </Pressable>
    </Animated.View>
  );
}

/**
 * A short string of lantern bulbs along the strip's top, in the map's lantern glass (saffron, food's
 * deep orange and a darker gold that shows on الرجعة's pale gold): the wire and the unlit glass are
 * drawn; each bulb's light comes on once, one after another. The curve is symmetric, so the string reads
 * the same in both directions; the lights start on the start side.
 */
const Lanterns = memo(function Lanterns({ w, wire }: { w: number; wire: string }) {
  const theme = useTheme();
  const food = theme.services.food;
  const glass = [food.fill, theme.services.back.fill, food.mesh[2]];
  if (w <= 0) return null;
  const n = Math.max(9, Math.round((w - INSET * 2) / BULB_EVERY) + 1);
  const bulbs = Array.from({ length: n }, (_, i) => {
    const q = i / (n - 1);
    const x = INSET + q * (w - INSET * 2);
    // `x` from the start side (the lit bulbs' `start`); `sx` the same point in the drawing, which is never mirrored.
    return { x, sx: theme.isRTL ? w - x : x, y: 9 + SAG * 4 * q * (1 - q), c: glass[i % 3]! };
  });
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, start: 0, width: w, height: STRING_H }}>
      <Svg width={w} height={STRING_H}>
        <Path d={`M0 3 Q ${w / 2} ${4 + SAG * 2} ${w} 3`} stroke={wire} strokeWidth={1} fill="none" />
        {bulbs.map((b, i) => (
          <Path key={`d${i}`} d={`M${b.sx} ${b.y - 5} L${b.sx} ${b.y - 2}`} stroke={wire} strokeWidth={1} />
        ))}
        {bulbs.map((b, i) => (
          <Circle key={`b${i}`} cx={b.sx} cy={b.y} r={BULB / 2} fill={withAlpha(b.c, 0.4)} />
        ))}
      </Svg>
      {bulbs.map((b, i) => (
        <Animated.View
          key={i}
          entering={theme.reduceMotion ? undefined : FadeIn.delay(LIGHT_DELAY_MS + i * LIGHT_STEP_MS).duration(LIGHT_MS)}
          style={{ position: 'absolute', start: b.x - BULB / 2, top: b.y - BULB / 2, width: BULB, height: BULB, borderRadius: BULB / 2, backgroundColor: b.c, boxShadow: `0px 0px 8px 2px ${withAlpha(b.c, 0.55)}` }}
        />
      ))}
    </View>
  );
});
