import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { CatalogSearchDish } from '@driver/contracts';
import { lift } from '@driver/design-tokens';
import { Icon, stageOf, Text, useMotionPresets, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { BAND_MAX_DISHES, BAND_MIN_DISHES } from './daypart';

/**
 * «وقت العزيزية» band (joy h1, idea 4-1): a title for the hour («للفطور», «للغدا اليوم»…) over up to
 * three real dishes from kitchens open now, as Date & Saffron dish cards in a row that runs to the
 * screen's edge: the dish on its own coloured plate, the name, the price in Alexandria, the kitchen,
 * and a saffron + (it opens the dish to add it; the one-tap counter comes with the touch step). Fewer
 * than two dishes and the band is not drawn at all: a thin, odd row is worse than none.
 */
export function DaypartBand({ title, dishes, testID = 'home-daypart' }: { title: string; dishes: readonly CatalogSearchDish[] | undefined; testID?: string }) {
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
            <DishCard d={d} testID={`${testID}-${i}`} />
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

/** A dish card's width: two and a bit show on a 390 phone, so the row reads as one to scroll. */
const CARD_W = 148;
const STAGE_H = 104;
/** The + is drawn 32 px; its tap area is the full 44. */
const PLUS = 32;

function DishCard({ d, testID }: { d: CatalogSearchDish; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const price = iqd(d.priceIqd, { locale });
  const open = () => {
    theme.haptic('selection');
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };
  return (
    <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, boxShadow: theme.scheme === 'light' ? lift.card : undefined }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('home.band_dish_a11y', { dish: d.name, restaurant: d.restaurantName, price })}
        onPress={open}
        style={({ pressed }) => ({ padding: theme.space[2], gap: 2, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
      >
        <View style={{ height: STAGE_H, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt {...artOf(d)} photoUrl={d.photoUrl} stage={stageOf(d.id, theme.decor.stages)} />
        </View>
        <Text variant="label" weight={700} numberOfLines={1} style={{ marginTop: theme.space[1] }}>
          {d.name}
        </Text>
        {/* The price sits on the start side; the + takes the end corner below it. */}
        <Text variant="label" face="display" numberOfLines={1} style={{ paddingEnd: PLUS + theme.space[1] }}>
          {price}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1} style={{ paddingEnd: PLUS + theme.space[1] }}>
          {d.restaurantName}
        </Text>
      </Pressable>
      <Pressable
        testID={`${testID}-add`}
        accessibilityRole="button"
        accessibilityLabel={t('home.dish_add_a11y', { dish: d.name })}
        onPress={open}
        hitSlop={(theme.hitTarget - PLUS) / 2}
        style={({ pressed }) => ({
          position: 'absolute',
          end: theme.space[2],
          bottom: theme.space[2],
          width: PLUS,
          height: PLUS,
          borderRadius: PLUS / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.accent,
          transform: [{ scale: pressed ? 0.9 : 1 }],
        })}
      >
        <Icon name="plus" size={18} color="onAccent" strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}
