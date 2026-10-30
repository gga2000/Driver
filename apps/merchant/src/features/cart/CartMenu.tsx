import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';
import type { AdminMenu, AdminMenuItem } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { absoluteUrl } from '@/features/menu/photo';
import { useMenuActions } from '@/features/menu/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { useCounterToast } from '@/lib/toast';
import { startsAt } from './item';

/**
 * «شنو تبيع؟» (Ali 2026-10-12): everything the cart sells, one row each: its photo (or its first letter on
 * fuchsia), name, price («من 1,500» with sizes), its extras, and the switch for tonight. A row opens the
 * cart's own editor; «ضيف شي» adds anything.
 */
export function CartMenu({ storeId, menu }: { storeId: string; menu: AdminMenu }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const actions = useMenuActions(storeId);
  const c = theme.services.carts;
  const items = menu.categories.flatMap((g) => g.items);

  return (
    <View style={{ gap: theme.space[4] }} testID="cart-menu">
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/cart/item')}
        testID="cart-menu-add"
        style={({ pressed }) => ({ minHeight: 64, borderRadius: 32, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], opacity: pressed ? 0.88 : 1 })}
      >
        <Icon name="plus" size={24} color={c.on} />
        <Text variant="title" face="display" style={{ color: c.on }}>
          {t('merchant.cart.menu_add')}
        </Text>
      </Pressable>

      {items.length === 0 ? (
        <Text variant="body" color="textMuted" align="center" style={{ paddingVertical: theme.space[6] }}>
          {t('merchant.cart.menu_empty')}
        </Text>
      ) : (
        <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, overflow: 'hidden', ...theme.elevation[1] }}>
          {items.map((it, i) => (
            <ItemRow
              key={it.id}
              item={it}
              first={i === 0}
              onToggle={(available) =>
                actions.setAvailability.mutate({ merchantOrgId: storeId, itemId: it.id, available }, { onError: (e) => toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) }) })
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ItemRow({ item, first, onToggle }: { item: AdminMenuItem; first: boolean; onToggle: (on: boolean) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const c = theme.services.carts;
  const price = startsAt(item);
  const extras = item.modifierGroups.filter((g) => !(g.required && g.maxSelect === 1)).flatMap((g) => g.modifiers.map((m) => m.nameAr));
  const sizes = item.modifierGroups.find((g) => g.required && g.maxSelect === 1)?.modifiers.map((m) => m.nameAr) ?? [];
  const sub = [...sizes, ...extras].join('، ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.border }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/cart/item', params: { id: item.id } })}
        testID={`cart-menu-item-${item.id}`}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: pressed ? 0.8 : 1 })}
      >
        <View style={{ width: 56, height: 56, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
          {item.photoUrl ? (
            <Image source={{ uri: absoluteUrl(item.photoUrl) }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <Text variant="title" face="display" style={{ color: c.on }}>
              {item.nameAr.trim().charAt(0)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="body" weight={600} numberOfLines={1} style={{ opacity: item.available ? 1 : 0.55 }}>
            {item.nameAr}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
            {price.from ? t('merchant.cart.price_from', { amount: iqd(price.priceIqd, { locale }) }) : iqd(price.priceIqd, { locale })}
            {sub ? ` · ${sub}` : ''}
          </Text>
        </View>
      </Pressable>
      <Switch value={item.available} onValueChange={onToggle} trackColor={{ true: c.fill, false: theme.colors.borderStrong }} thumbColor={theme.colors.surface} {...{ activeThumbColor: theme.colors.surface }} accessibilityLabel={t('merchant.cart.menu_tonight', { name: item.nameAr })} testID={`cart-menu-toggle-${item.id}`} />
    </View>
  );
}
