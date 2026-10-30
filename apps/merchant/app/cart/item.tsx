import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Skeleton, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { CartItemEditor } from '@/features/cart/CartItemEditor';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';

/** A cart's dish, its own way: `?id=` edits one, no id adds anything he sells. */
export default function CartItemPage() {
  const theme = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { store } = useCurrentStore();
  const menu = useMenu(store?.orgId ?? null);
  return (
    <Page title={t(id ? 'merchant.cart.item_edit_title' : 'merchant.cart.item_new_title')} back maxWidth={640} testID="cart-item-page">
      <Loadable query={menu} failed={t('merchant.cart.load_failed')} testID="cart-item-load" skeleton={<View style={{ gap: theme.space[3] }}><Skeleton height={120} /><Skeleton height={56} /><Skeleton height={56} /></View>}>
        {(m) => {
          const item = id ? (m.categories.flatMap((g) => g.items).find((i) => i.id === id) ?? null) : null;
          return store ? <CartItemEditor key={item?.id ?? 'new'} storeId={store.orgId} item={item} /> : null;
        }}
      </Loadable>
    </Page>
  );
}
