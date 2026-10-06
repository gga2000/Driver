import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
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
  const shown = (dishes ?? []).slice(0, BAND_MAX_DISHES);
  if (shown.length < BAND_MIN_DISHES) return null;
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader voice title={title} />
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        {shown.map((d, i) => (
          <Animated.View key={d.id} entering={presets.panelIn(presets.staggerDelay(i))} style={{ flex: 1, maxWidth: shown.length < BAND_MAX_DISHES ? '50%' : undefined }}>
            <DishTile d={d} testID={`${testID}-${i}`} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

function DishTile({ d, testID }: { d: CatalogSearchDish; testID: string }) {
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
      <View style={{ width: '100%', aspectRatio: 1, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
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
