import { View } from 'react-native';
import { Skeleton, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { CartMenu } from '@/features/cart/CartMenu';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';

/** «شنو تبيع؟»: the cart's dishes, opened from «فتحت هنا». */
export default function CartMenuPage() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const menu = useMenu(store?.orgId ?? null);
  return (
    <Page title={t('merchant.cart.menu_title')} back maxWidth={640} testID="cart-menu-page">
      <Loadable
        query={menu}
        failed={t('merchant.cart.load_failed')}
        testID="cart-menu-load"
        skeleton={
          <View style={{ gap: theme.space[3] }}>
            <Skeleton height={64} />
            <Skeleton height={240} />
          </View>
        }
      >
        {(m) => (store ? <CartMenu storeId={store.orgId} menu={m} /> : null)}
      </Loadable>
    </Page>
  );
}
