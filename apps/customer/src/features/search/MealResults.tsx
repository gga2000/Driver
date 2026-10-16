import { View } from 'react-native';
import type { CatalogSearchDish } from '@driver/contracts';
import { Card, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { RestaurantRow } from '@/features/food/RestaurantRow';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useT } from '@/lib/i18n';
import { DishResult } from './DishResult';
import type { MealKey } from './intents';

/**
 * A meal word answered (joy h4, discovery D-13): «فطور» finds no dish called «فطور», so the box
 * shows what breakfast is in this town — real dishes from kitchens open now (`catalog.picks`) and the
 * kitchens tagged for it. Nothing qualifies → nothing drawn (the screen's empty state takes over).
 */
export function MealResults({
  meal,
  dishes,
  kitchens,
  onDish,
  onKitchen,
}: {
  meal: MealKey;
  dishes: readonly CatalogSearchDish[];
  kitchens: readonly RestaurantSummary[];
  onDish: (d: CatalogSearchDish) => void;
  onKitchen: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  if (dishes.length === 0 && kitchens.length === 0) return null;
  return (
    <View style={{ gap: theme.space[3] }} testID={`search-meal-${meal}`}>
      <SectionHeader big title={t(`search.meal_${meal}`)} />
      {dishes.length > 0 ? (
        <Card elevation={0} padding={0}>
          {dishes.map((d, i) => (
            <DishResult key={d.id} d={d} divider={i < dishes.length - 1} onPress={() => onDish(d)} />
          ))}
        </Card>
      ) : null}
      {kitchens.map((r) => (
        <RestaurantRow key={r.id} r={r} testID={`search-meal-restaurant-${r.id}`} onOpen={onKitchen} />
      ))}
    </View>
  );
}

/** Kitchens whose tags suit the meal, open ones first (the list's own order otherwise). */
export function kitchensForMeal<K extends Pick<RestaurantSummary, 'tags' | 'open'>>(all: readonly K[], tags: readonly string[]): K[] {
  if (tags.length === 0) return [];
  return all.filter((r) => r.tags.some((tag) => tags.includes(tag))).sort((a, b) => Number(b.open) - Number(a.open));
}
