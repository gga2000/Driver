import { View } from 'react-native';
import { Skeleton, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { CartHours } from '@/features/cart/CartHours';
import { useCartOwner } from '@/features/cart/queries';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';

/** «أوقاتك والإجازة»: a cart's usual hours and away note, opened from «فتحت هنا». */
export default function CartHoursPage() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const owner = useCartOwner(store?.orgId ?? null);
  return (
    <Page title={t('merchant.cart.hours_title')} back maxWidth={640} testID="cart-hours-page">
      <Loadable
        query={owner}
        failed={t('merchant.cart.load_failed')}
        testID="cart-hours-load"
        skeleton={
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={88} />
            <Skeleton height={240} />
          </View>
        }
      >
        {(view) => <CartHours view={view} />}
      </Loadable>
    </Page>
  );
}
