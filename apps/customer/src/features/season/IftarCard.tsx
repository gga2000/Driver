import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatClock, formatMinutes } from '@driver/i18n';
import { Button, CornerFill, Text, useTheme, withAlpha } from '@driver/ui';
import { motifForKitchen } from '@/features/food/FoodArt';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { kitchenPhotos } from '@/features/home/dish-photos';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { ramadanKitchens, type RamadanLine } from './ramadan';

/** How many of the kitchens that make it show their photo, its size and how far each tucks under the last. */
const FACES = 4;
const FACE = 34;
const OVERLAP = 10;
/** The lantern string: its height, how far it sags in the middle, and one bulb about every this many px. */
const STRING_H = 34;
const SAG = 10;
const BULB_EVERY = 22;
/** The first and last bulbs stay this far in from the sides, clear of the rounded corners. */
const INSET = 14;
/** The bulbs light one after another once, from the start side, then stay lit. */
const LIGHT_DELAY_MS = 350;
const LIGHT_STEP_MS = 55;
const LIGHT_MS = 360;

/**
 * The Ramadan card on a festive day (home roast 3 look R1, map idea N2's iftar line): a Ramadan night
 * in الرجعة's date brown with a string of lanterns across its top that light up once, the time left to
 * iftar big (or until when suhoor runs) with the adhan's time on the person's timetable, and, in the
 * last hours before iftar, the kitchens that still make it before the adhan with a way to order.
 */
export function IftarCard({ line, timetable, kitchens }: { line: Exclude<RamadanLine, { kind: 'none' }>; timetable: string | null; kitchens: readonly RestaurantSummary[] }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const night = theme.services.trips;
  const [w, setW] = useState(0);
  const iftar = line.kind === 'iftar';
  const label = t(iftar ? 'season.iftar_after' : 'season.suhoor_label');
  const big = iftar ? formatMinutes(line.minutes, { locale }) : formatClock(line.at, { locale });
  const meta = [iftar ? t('season.iftar_at', { time: formatClock(line.at, { locale }) }) : null, timetable ? t('season.by_timetable', { timetable }) : null].filter((m): m is string => m !== null);
  const making = useMemo(() => ramadanKitchens(kitchens, line), [kitchens, line]);
  const n = making.length;
  const count = t(iftar ? 'season.iftar_kitchens' : 'home.food_open', { n });
  return (
    <View testID="home-season" onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: night.fill }}>
      <CornerFill base={night.fill} light={night.light} />
      <Lanterns w={w} wire={withAlpha(night.on, 0.32)} />
      <View style={{ paddingTop: STRING_H + theme.space[2], paddingHorizontal: theme.space[5], paddingBottom: theme.space[5], gap: theme.space[4] }}>
        <View
          testID={`home-season-${line.kind}`}
          accessible
          accessibilityLabel={[`${label} ${big}`, ...meta].join('، ')}
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: theme.space[4], rowGap: theme.space[1] }}
        >
          <View style={{ flexShrink: 1 }}>
            <Text variant="footnote" weight={600} color={night.sub}>
              {label}
            </Text>
            <Text variant="numeralSm" face="display" color={night.on} tabular>
              {big}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', paddingBottom: theme.space[1] }}>
            {meta.map((m, i) => (
              <Text key={i} variant={i === 0 && iftar ? 'bodyStrong' : 'caption'} color={i === 0 && iftar ? night.on : withAlpha(night.on, 0.78)} tabular>
                {m}
              </Text>
            ))}
          </View>
        </View>
        {n > 0 ? (
          <>
            <View testID="home-season-kitchens" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: withAlpha(night.on, 0.12) }}>
              <Faces kitchens={making} ring={night.fill} />
              <Text variant="footnote" weight={500} color={withAlpha(night.on, 0.88)} tabular style={{ flex: 1 }} numberOfLines={2}>
                {count}
              </Text>
            </View>
            <Button testID="home-season-go" label={t(iftar ? 'season.iftar_go' : 'season.suhoor_go')} fullWidth onPress={() => router.push({ pathname: '/restaurants', params: { preset: 'open' } })} />
          </>
        ) : null}
      </View>
    </View>
  );
}

/** The first few kitchens' photos (their own, else one of their kind), tucked under each other. */
function Faces({ kitchens, ring }: { kitchens: readonly RestaurantSummary[]; ring: string }) {
  const theme = useTheme();
  const first = kitchens.slice(0, FACES);
  const photos = useMemo(() => kitchenPhotos(kitchens.slice(0, FACES).map((r) => motifForKitchen(r.tags, r.cuisine))), [kitchens]);
  const faces = first.map((r, i) => apiPhoto(r.photoUrl) ?? photos[i] ?? null).filter((f): f is string | number => f !== null);
  if (faces.length === 0) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row' }}>
      {faces.map((f, i) => (
        <View key={i} style={{ width: FACE, height: FACE, marginStart: i === 0 ? 0 : -OVERLAP, borderRadius: FACE / 2, borderWidth: 2, borderColor: ring, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <FoodPhoto photo={f} style={{ width: '100%', height: '100%' }} />
        </View>
      ))}
    </View>
  );
}

/**
 * A string of lantern bulbs across the card's top, in the map's lantern glass (saffron, gold, deep
 * orange): the wire and the unlit glass are drawn; each bulb's light comes on once, one after another.
 * The curve is symmetric, so the string reads the same in both directions; the lights start on the start side.
 */
const Lanterns = memo(function Lanterns({ w, wire }: { w: number; wire: string }) {
  const theme = useTheme();
  const food = theme.services.food;
  const glass = [food.fill, theme.services.back.fill, food.mesh[2]];
  if (w <= 0) return null;
  const n = Math.max(9, Math.round(w / BULB_EVERY));
  const bulbs = Array.from({ length: n }, (_, i) => {
    const p = i / (n - 1);
    const x = INSET + p * (w - INSET * 2);
    // `x` from the start side (the lit bulbs' `start`); `sx` the same point in the drawing, which is never mirrored.
    return { x, sx: theme.isRTL ? w - x : x, y: 10 + SAG * 4 * p * (1 - p), c: glass[i % 3]! };
  });
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, start: 0, width: w, height: STRING_H }}>
      <Svg width={w} height={STRING_H}>
        <Path d={`M0 4 Q ${w / 2} ${6 + SAG * 2} ${w} 4`} stroke={wire} strokeWidth={1.2} fill="none" />
        {bulbs.map((b, i) => (
          <Path key={`d${i}`} d={`M${b.sx} ${b.y - 6} L${b.sx} ${b.y - 2}`} stroke={wire} strokeWidth={1} />
        ))}
        {bulbs.map((b, i) => (
          <Circle key={`b${i}`} cx={b.sx} cy={b.y} r={3.6} fill={withAlpha(b.c, 0.4)} />
        ))}
      </Svg>
      {bulbs.map((b, i) => (
        <Animated.View
          key={i}
          entering={theme.reduceMotion ? undefined : FadeIn.delay(LIGHT_DELAY_MS + i * LIGHT_STEP_MS).duration(LIGHT_MS)}
          style={{ position: 'absolute', start: b.x - 4, top: b.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: b.c, boxShadow: `0px 0px 10px 3px ${withAlpha(b.c, 0.55)}` }}
        />
      ))}
    </View>
  );
});
