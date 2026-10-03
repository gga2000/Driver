import { View } from 'react-native';
import { Card, EmptyState, Icon, ListRow, StatusPill, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';

/**
 * المحفظة — placeholder. TODO(api): there is no customer wallet read yet (`ledger.*` serves
 * drivers and merchants only), so we show no balance rather than a made-up zero. Spec §9
 * (balance, points, transactions, top-up, household) lands with the wallet milestone.
 */
export default function Wallet() {
  const theme = useTheme();
  const t = useT();
  return (
    <Screen testID="wallet">
      <Text variant="heading" accessibilityRole="header">
        {t('nav.wallet_short')}
      </Text>
      <Card padding={5} style={{ backgroundColor: theme.colors.text }}>
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="wallet" size={22} color={theme.colors.accentTint} />
              <Text variant="label" color={theme.colors.accentTint}>
                {t('wallet.balance')}
              </Text>
            </View>
            <StatusPill size="sm" tone="accent" label={t('wallet.soon_badge')} />
          </View>
          <Text variant="body" color={theme.colors.bg}>
            {t('wallet.coming_soon')}
          </Text>
        </View>
      </Card>
      <Card elevation={0} padding={0}>
        <ListRow leading="garage" title={t('wallet.top_up_agent')} trailing={<StatusPill size="sm" label={t('wallet.soon_badge')} />} divider />
        <ListRow leading="car" title={t('wallet.top_up_via_driver')} trailing={<StatusPill size="sm" label={t('wallet.soon_badge')} />} />
      </Card>
      <EmptyState icon="receipt" title={t('empty.wallet')} body={t('empty.points')} />
    </Screen>
  );
}
