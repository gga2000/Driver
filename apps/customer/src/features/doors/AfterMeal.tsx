import { View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { IconButton, Text, useTheme } from '@driver/ui';
import { FoodArt, artOf, type DishArt } from '@/features/food/FoodArt';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * «وياها كنافة؟» (idea s7): after a meal goes in, one quiet line over the cart bar offering this same
 * kitchen's sweet — once a visit, never a popup, gone with a tap on ✕. The same shop, so the order
 * stays one shop (g4).
 */
export function AfterMeal({ item, art, onAdd, onDismiss }: { item: MenuItem; art: DishArt | undefined; onAdd: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="after-meal"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        padding: theme.space[2],
        paddingStart: theme.space[2],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden' }}>
        <FoodArt {...(art ?? artOf(item))} photoUrl={item.photoUrl} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" weight={700} numberOfLines={1}>
          {t('restaurant.after_meal', { dish: item.name })}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {t('unit.iqd', { amount: amountParam(item.priceIqd) })}
        </Text>
      </View>
      <IconButton testID="after-meal-add" icon="plus" size={44} variant="accent" accessibilityLabel={t('restaurant.after_meal_a11y', { dish: item.name, amount: amountParam(item.priceIqd) })} onPress={onAdd} />
      <IconButton testID="after-meal-dismiss" icon="x" size={44} variant="plain" accessibilityLabel={t('action.close')} onPress={onDismiss} />
    </View>
  );
}
