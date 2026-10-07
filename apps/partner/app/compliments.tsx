import { Stack } from 'expo-router';
import { View } from 'react-native';
import { formatDay, pluralKey } from '@driver/i18n';
import { Card, EmptyState, formatClock, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { ComplimentPills, complimentWords } from '@/features/account/ComplimentParts';
import { useCompliments } from '@/features/account/queries';
import { useLocale, useT } from '@/lib/i18n';

/**
 * «كلام الزبائن» (joy l4): the kind words customers picked for him after a 4–5 rating — how many
 * customers, each word counted, then the latest ones with the order number and when. Never who said
 * it. Opened from the account hub, the shift summary and the «كلام حلو عنك» push.
 */
export default function ComplimentsScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const q = useCompliments();
  const data = q.data;
  // «اليوم 2:49 ص», «أمس 9:49 م», «الأحد 1:19 ص»: the day each word came, by Baghdad's calendar.
  const now = new Date();
  const [slow, restartSlow] = useLoadTimeout(!data && !q.isError);
  return (
    <Screen testID="compliments" edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.compliments_title') }} />
      {!data ? (
        q.isError || slow ? (
          <RetryState
            testID="compliments-retry"
            kind={retryKindFor({ net, error: q.error, slow })}
            locale={locale}
            title={net.state === 'offline' ? t('partner.compliments_offline') : t('partner.compliments_failed')}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        ) : (
          <View testID="compliments-loading" style={{ gap: theme.space[3] }}>
            <Card elevation={1} padding={5}>
              <Skeleton lines={3} />
            </Card>
            <Skeleton height={140} />
          </View>
        )
      ) : data.customers === 0 ? (
        <View testID="compliments-empty">
          <EmptyState icon="heart" title={t('partner.compliments_empty')} body={t('partner.compliments_empty_sub')} />
        </View>
      ) : (
        <>
          <Card elevation={1} padding={5} testID="compliments-summary">
            <View style={{ gap: theme.space[3] }}>
              <Text variant="title" tabular>
                {t(pluralKey('partner.compliments_customers', data.customers), { n: data.customers })}
              </Text>
              <ComplimentPills counts={data.counts} testID="compliments-counts" />
            </View>
          </Card>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
              {t('partner.compliments_recent')}
            </Text>
            <Card elevation={1} padding={0} style={{ paddingHorizontal: theme.space[4] }}>
              {data.recent.map((r, i) => (
                <View
                  key={`${r.ticket}-${r.at.getTime()}`}
                  testID={`compliment-row-${i}`}
                  style={{ paddingVertical: theme.space[3], gap: 2, borderBottomWidth: i < data.recent.length - 1 ? 1 : 0, borderColor: theme.colors.border }}
                >
                  <Text variant="body" weight={600}>
                    {complimentWords(r.keys, t)}
                  </Text>
                  <Text variant="caption" color="textMuted" tabular>
                    {`${t('order.number', { id: r.ticket })} · ${formatDay(r.at, now, { locale })} ${formatClock(r.at, { locale })}`}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        </>
      )}
    </Screen>
  );
}
