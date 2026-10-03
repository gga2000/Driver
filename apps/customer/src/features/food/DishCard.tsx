import { Pressable, View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { IconButton, StatusPill, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { FoodArt, motifForDish } from './FoodArt';
import { canQuickAdd, fromPrice } from './modifiers';

export interface DishCardProps {
  item: MenuItem;
  /** How many of this dish are already in the cart. */
  inCart: number;
  /** Kitchen closed: browse only. */
  disabled?: boolean;
  onOpen: () => void;
  /** One-tap add (dishes without a required choice); otherwise the + opens the sheet. */
  onQuickAdd: () => void;
}

/** A menu row: name, description, price, and a thumbnail with the + button on its corner. */
export function DishCard({ item, inCart, disabled, onOpen, onQuickAdd }: DishCardProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const price = fromPrice(item);
  const soldOut = !item.available;
  const quick = canQuickAdd(item);
  return (
    <Pressable
      testID={`dish-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}، ${iqd(price.amount, { locale })}`}
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: theme.space[3],
        paddingVertical: theme.space[4],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: soldOut ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </Text>
        {item.description ? (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: 2 }}>
          <Text variant="label" weight={600} tabular>
            {price.varies ? t('restaurant.price_from', { amount: amountParam(price.amount) }) : iqd(price.amount, { locale })}
          </Text>
          {soldOut ? <StatusPill size="sm" tone="neutral" label={t('item.sold_out')} /> : null}
        </View>
      </View>
      <View style={{ width: 96, height: 96 }}>
        <View style={{ width: 96, height: 96, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt motif={motifForDish(item.name)} photoUrl={item.photoUrl} />
        </View>
        {!soldOut && !disabled ? (
          <IconButton
            testID={`dish-add-${item.id}`}
            icon="plus"
            size={36}
            variant={inCart > 0 ? 'accent' : 'outline'}
            accessibilityLabel={t('restaurant.add_item', { name: item.name })}
            onPress={quick ? onQuickAdd : onOpen}
            style={{ position: 'absolute', bottom: -6, start: -6 }}
          />
        ) : null}
        {inCart > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              end: -6,
              minWidth: 24,
              height: 24,
              paddingHorizontal: 6,
              borderRadius: 12,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" weight={700} color="bg" tabular>
              {inCart}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
