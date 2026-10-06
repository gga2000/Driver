import { router } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { CatalogSearchDish } from '@driver/contracts';
import { Text, useMotionPresets, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { BAND_MAX_DISHES, BAND_MIN_DISHES } from './daypart';

/**
 * «وقت العزيزية» band (joy h1, idea 4-1): a title for the hour («للفطور», «للغدا اليوم»…) over up to
 * three real dishes from kitchens open now — the drawing, the name, the price and the kitchen. Each
 * opens that dish on its restaurant. Fewer than two dishes and the band is not drawn at all: a thin,
 * odd row is worse than none. No haptics; it rises in once (still under reduced motion).
 */
export function DaypartBand({ title, dishes, testID = 'home-daypart' }: { title: string; dishes: readonly CatalogSearchDish[] | undefined; testID?: string }) {
  const theme = useTheme();
  const presets = useMotionPresets();
  const { width } = useWindowDimensions();
  const shown = (dishes ?? []).slice(0, BAND_MAX_DISHES);
  if (shown.length < BAND_MIN_DISHES) return null;
  // Three tiles across the screen's content width (gutters `space[5]`, the column capped like Screen's).
  const tile = Math.floor((Math.min(width, MAX_CONTENT) - theme.space[5] * 2 - theme.space[3] * (BAND_MAX_DISHES - 1)) / BAND_MAX_DISHES);
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader voice title={title} />
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        {shown.map((d, i) => (
          <Animated.View key={d.id} entering={presets.panelIn(presets.staggerDelay(i))} style={{ width: tile }}>
            <DishTile d={d} size={tile} testID={`${testID}-${i}`} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** Screen's content column never grows past this (tablets): the tiles stay dish-sized. */
const MAX_CONTENT = 560;

function DishTile({ d, size, testID }: { d: CatalogSearchDish; size: number; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const price = iqd(d.priceIqd, { locale });
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('home.band_dish_a11y', { dish: d.name, restaurant: d.restaurantName, price })}
      onPress={() => {
        theme.haptic('selection');
        router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
      }}
      style={({ pressed }) => ({ gap: theme.space[1], opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={{ width: size, height: size, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        <FoodArt {...artOf(d)} photoUrl={d.photoUrl} />
      </View>
      <Text variant="label" weight={600} numberOfLines={2} style={{ minHeight: 40 }}>
        {d.name}
      </Text>
      <Text variant="footnote" weight={600} tabular>
        {price}
      </Text>
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {d.restaurantName}
      </Text>
    </Pressable>
  );
}
