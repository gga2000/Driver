import { router } from 'expo-router';
import { View } from 'react-native';
import type { CartCard } from '@driver/contracts';
import { Card, Icon, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { CartBell } from './CartBell';
import { CartPhoto } from './CartPhoto';
import { cartPalette } from './palette';
import { cartStatus } from './status';

const PHOTO = 96;

/**
 * One cart in «عربانات العزيزية» (look B): its photo on the reading side, the name in the brand face,
 * its first dish and price, where it stands (a cream chip with the fuchsia dot while open) and the
 * walking minutes; the follow bell on the far side. A tap opens the cart.
 */
export function CartRow({ card, testID }: { card: CartCard; testID?: string }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const locale = useLocale();
  const first = card.dishes[0];
  const status = cartStatus(t, card, locale);
  const dishLine = first ? t('food.dish_price', { dish: first.nameAr, amount: amountParam(first.priceIqd) }) : null;
  const walk = card.walkMin !== null ? t('carts.walk_min', { n: card.walkMin }) : null;
  const id = testID ?? `cart-row-${card.id}`;
  return (
    <Card testID={id} padding={3} lift onPress={() => router.push({ pathname: '/food-carts/[id]', params: { id: card.id } })} accessibilityLabel={[card.name, dishLine, status, walk ? t('carts.walk_a11y', { n: card.walkMin ?? 0 }) : null].filter(Boolean).join('، ')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <CartPhoto card={card} size={PHOTO} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="title" face="display" numberOfLines={2} color={card.open ? 'text' : 'textMuted'}>
            {card.name}
          </Text>
          {dishLine ? (
            <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
              {dishLine}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2], marginTop: 2 }}>
            <View testID={`${id}-status`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 14, backgroundColor: theme.colors.surfaceSunken }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: card.open ? pal.fill : theme.colors.borderStrong }} />
              <Text variant="caption" weight={600} compact color={card.open ? pal.text : 'textMuted'} numberOfLines={1} tabular>
                {status}
              </Text>
            </View>
            {walk ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="walk" size={16} color={theme.colors.text} />
                <Text variant="caption" weight={600} compact tabular>
                  {walk}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <CartBell card={card} />
      </View>
    </Card>
  );
}
