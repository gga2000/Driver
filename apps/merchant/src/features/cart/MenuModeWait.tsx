import { View } from 'react-native';
import { Skeleton, useTheme } from '@driver/ui';
import { Page } from '@/components/Page';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

/**
 * The «المنيو» tab while it is still finding out whether this store is a cart: the menu's own loading
 * look (the same title and grid of tiles as MenuScreen's), so a cart owner never sees the restaurant
 * menu for a moment and a restaurant sees what it always saw.
 */
export function MenuModeWait() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  return (
    <Page title={t('merchant.nav.menu')} testID="menu-mode-wait">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        {Array.from({ length: wide ? 8 : 4 }, (_, i) => (
          <Skeleton key={i} width={wide ? 196 : '47%'} height={wide ? 220 : 200} radius={theme.radius.xl} />
        ))}
      </View>
    </Page>
  );
}
