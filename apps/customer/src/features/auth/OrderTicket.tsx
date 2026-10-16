import { pluralKey } from '@driver/i18n';
import { View } from 'react-native';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { itemsTotal } from '@/features/food/cart';
import { useCart } from '@/features/food/cart-store';
import { artOf, FoodArt } from '@/features/food/FoodArt';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The basket that waits while the guest signs in (concept D's ticket on the golden sheet): the first
 * dish's picture, the shop, how many dishes and their total, so every step says what it is for. The
 * total is the menu prices he already saw; the server prices the order at checkout. Nothing shows
 * when the cart is empty (he came here from «عندك حساب؟» or a booking).
 */
export function OrderTicket() {
  const theme = useTheme();
  const t = useT();
  const cart = useCart();
  if (!cart.merchant || cart.lines.length === 0) return null;
  const first = cart.lines[0]!;
  const art = artOf({ id: first.itemId, name: first.name });
  const count = cart.lines.reduce((n, l) => n + l.qty, 0);
  const dishes = t(pluralKey('auth.ticket_dishes', count), { n: count });
  const total = t('unit.iqd', { amount: amountParam(itemsTotal(cart)) });
  return (
    <View
      testID="auth-ticket"
      accessible
      accessibilityLabel={t('auth.ticket_a11y', { shop: cart.merchant.name, dishes, total })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: withAlpha(theme.colors.inverse, 0.82),
      }}
    >
      <View style={{ width: 56, height: 56, borderRadius: theme.radius.md, overflow: 'hidden' }}>
        <FoodArt motif={art.motif} look={art.look} variant="thumb" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" weight={700} color="onInverse" numberOfLines={1}>
          {cart.merchant.name}
        </Text>
        <Text variant="footnote" color="onInverseMuted" numberOfLines={1}>
          {t('auth.ticket_waits', { dishes })}
        </Text>
      </View>
      <Text variant="bodyStrong" weight={700} color="onInverseAccent" tabular>
        {total}
      </Text>
    </View>
  );
}
