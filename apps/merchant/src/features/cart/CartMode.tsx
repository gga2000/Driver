import { View } from 'react-native';
import { Skeleton, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { OpenHere } from './OpenHere';
import { useCartOwner } from './queries';
import { Tonight } from './Tonight';

/**
 * The orders tab of a food cart («عربانة», Ali 2026-10-11): closed, it is «فتحت هنا» (v1); open, it is
 * tonight's walk-over tickets (v2). Delivery orders still come through the restaurants' board.
 */
export function CartMode() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const owner = useCartOwner(store?.orgId ?? null);
  const open = owner.data?.cart.open ?? false;
  return (
    <Page title={open ? t('merchant.cart.tonight_title') : (owner.data?.cart.name ?? store?.name ?? '')} maxWidth={640} testID="cart-mode">
      <Loadable
        query={owner}
        failed={t('merchant.cart.load_failed')}
        testID="cart-mode-load"
        skeleton={
          <View style={{ gap: theme.space[4] }}>
            <Skeleton height={96} />
            <Skeleton height={180} />
            <Skeleton height={180} />
          </View>
        }
      >
        {(view) => (view.cart.open ? <Tonight view={view} /> : <OpenHere view={view} />)}
      </Loadable>
    </Page>
  );
}
