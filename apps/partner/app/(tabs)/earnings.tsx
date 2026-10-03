import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, EmptyState, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { CashBar } from '@/features/work/HomeParts';
import { jobsKey } from '@/features/work/logic';
import { useStatus } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * الأرباح — wave 1 shows today's total and the cash cap from `partner.status`; wave 2 replaces this
 * tab with the full earnings + ledger screen (per-job components, statement, settlement) and fills
 * `app/earnings/*` (`/earnings/statement` is the placeholder detail route).
 */
export default function EarningsTab() {
  const theme = useTheme();
  const t = useT();
  const s = useStatus().data;
  return (
    <Screen testID="earnings-tab">
      <Text variant="heading" accessibilityRole="header">
        {t('partner.nav_earnings')}
      </Text>
      <Card elevation={1} padding={5}>
        {s ? (
          <View style={{ gap: theme.space[4] }}>
            <View style={{ gap: 2 }}>
              <Text variant="label" color="textMuted">
                {t('partner.earnings_today_title')}
              </Text>
              <Text variant="display" tabular>
                {`${amountParam(s.today.earningsIqd)} `}
                <Text variant="title" color="textMuted">
                  {t('quote.currency')}
                </Text>
              </Text>
              <Text variant="label" color="textMuted" tabular>
                {t(jobsKey(s.today.jobs), { n: s.today.jobs })}
              </Text>
            </View>
            {s.canDrive ? <CashBar cash={s.cash} /> : null}
          </View>
        ) : (
          <Skeleton lines={3} />
        )}
      </Card>
      <EmptyState icon="receipt" title={t('partner.earnings_breakdown')} body={t('partner.earnings_soon')} />
      <Button label={t('partner.earnings_breakdown')} variant="secondary" fullWidth onPress={() => router.push('/earnings/statement')} />
    </Screen>
  );
}
