import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { baghdadMonth, MonthKey, type MonthInsightsView } from '@driver/contracts';
import type { IconName } from '@driver/ui';
import { Button, Card, EmptyState, Icon, IconButton, RetryState, retryKindFor, SketchScene, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { GuestGate } from '@/components/GuestGate';
import { monthLabel, monthSteps, warmLine } from '@/features/account/month';
import { useMonth } from '@/features/account/queries';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

/**
 * «شهرك ويا درايفر» (joy w6, audit S-5): the person's own month, every figure counted by the server —
 * meals and the kitchens they came from, the favourite kitchen and dish, rides, الرجعة trips, what was
 * saved and the points earned — with one warm line. Private: no share button, and the page says so.
 * Steps back up to twelve months. Opened from the wallet, the account and the month-start card.
 */
export default function MonthPage() {
  return useSignedIn() ? <Month /> : <GuestGate kind="wallet" />;
}

function Month() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const params = useLocalSearchParams<{ month?: string }>();
  const current = baghdadMonth(new Date());
  const asked = MonthKey.safeParse(params.month);
  const [month, setMonth] = useState<MonthKey>(asked.success && asked.data <= current ? asked.data : current);
  const q = useMonth(month);
  const v = q.data?.month === month ? q.data : null;

  const label = (m: MonthKey) => {
    const l = monthLabel(m);
    return t('month.label', { month: t(l.nameKey), year: l.year });
  };
  const steps = v ? monthSteps(month, v.earliestMonth, current) : { prev: null, next: null };

  return (
    <Screen edges={['bottom']} testID="month">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
        <IconButton testID="month-prev" icon="chevron-back" accessibilityLabel={t('month.prev')} disabled={!steps.prev} onPress={() => steps.prev && setMonth(steps.prev)} />
        <Text variant="heading" accessibilityRole="header" align="center" style={{ flex: 1 }} testID="month-label">
          {label(month)}
        </Text>
        <IconButton testID="month-next" icon="chevron-forward" accessibilityLabel={t('month.next')} disabled={!steps.next} onPress={() => steps.next && setMonth(steps.next)} />
      </View>

      {q.isError && !v ? (
        <RetryState
          kind={retryKindFor({ net, error: q.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: q.error }) === 'server' ? { title: t('month.load_error') } : {})}
          onRetry={() => void q.refetch()}
        />
      ) : !v ? (
        <View style={{ gap: theme.space[3] }} testID="month-loading">
          <Skeleton height={160} />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      ) : !v.hasActivity ? (
        <EmptyState
          icon="receipt"
          art={<SketchScene name="empty_orders" />}
          title={month === current ? t('month.empty_now_title') : t('month.empty_title')}
          body={t('month.empty_body')}
          action={{ label: t('month.order_cta'), onPress: () => router.push('/restaurants') }}
        />
      ) : (
        <MonthBody v={v} />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], paddingVertical: theme.space[2] }}>
        <Icon name="shield" size={16} color="textMuted" />
        <Text variant="caption" color="textMuted" testID="month-private">
          {t('month.private')}
        </Text>
      </View>
    </Screen>
  );
}

function MonthBody({ v }: { v: MonthInsightsView }) {
  const theme = useTheme();
  const t = useT();
  const line = warmLine(v, (n) => amountParam(n));
  return (
    <View style={{ gap: theme.space[4] }}>
      <Card padding={0} testID="month-hero">
        <SketchScene name={v.rajaaTrips > 0 ? 'safe_arrival' : 'kitchen'} animate={false} style={{ width: '100%', aspectRatio: 2 }} />
        {line ? (
          <View style={{ padding: theme.space[4] }}>
            <Text variant="title" testID="month-line">
              {t(line.key, line.params)}
            </Text>
          </View>
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        {v.meals > 0 ? <Tile icon="food" title={t('month.meals', { n: v.meals })} caption={t('month.kitchens', { n: v.kitchens })} testID="month-meals" /> : null}
        {v.rides > 0 ? <Tile icon="tuktuk" title={t('month.rides', { n: v.rides })} caption={t('month.rides_label')} testID="month-rides" /> : null}
        {v.rajaaTrips > 0 ? <Tile icon="rajaa" title={t('month.rajaa', { n: v.rajaaTrips })} caption={t('month.rajaa_label')} testID="month-rajaa" /> : null}
      </View>

      {v.topKitchen ? (
        <Card elevation={0} padding={4} testID="month-top-kitchen">
          <View style={{ gap: theme.space[1] }}>
            <Text variant="label" color="textMuted">
              {t('month.top_kitchen_title')}
            </Text>
            <Text variant="title">{v.topKitchen.name}</Text>
            <Text variant="footnote" color="textMuted">
              {t('month.times', { n: v.topKitchen.orders })}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* "The dish you came back to" needs a second order of it. */}
      {v.topDish && v.topDish.orders >= 2 ? (
        <Card elevation={0} padding={4} testID="month-top-dish">
          <View style={{ gap: theme.space[1] }}>
            <Text variant="label" color="textMuted">
              {t('month.top_dish_title')}
            </Text>
            <Text variant="title">{v.topDish.name}</Text>
            <Text variant="footnote" color="textMuted">
              {[v.topDish.kitchen ? t('month.top_dish_from', { kitchen: v.topDish.kitchen }) : null, t('month.times', { n: v.topDish.orders })].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Card>
      ) : null}

      {v.savedIqd > 0 ? (
        <Card padding={4} tone="tint" testID="month-saved">
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
            <Icon name="gift" size={22} color="successText" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" color="successText" tabular>
                {t('month.saved_title', { amount: amountParam(v.savedIqd) })}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('month.saved_body')}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {v.pointsEarned > 0 ? (
        <Card elevation={0} padding={4} testID="month-points">
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
            <Icon name="star" size={22} color="starOutline" filled fillColor="star" />
            <Text variant="bodyStrong" tabular style={{ flex: 1 }}>
              {t('month.points', { n: amountParam(v.pointsEarned) })}
            </Text>
          </View>
        </Card>
      ) : null}

      <Button variant="secondary" icon="wallet" label={t('wallet.history')} onPress={() => router.push('/wallet')} />
    </View>
  );
}

/** A stat tile: the counted phrase («4 أكلات وصلتك») over its caption; half a row on a phone. */
function Tile({ icon, title, caption, testID }: { icon: IconName; title: string; caption: string; testID: string }) {
  const theme = useTheme();
  return (
    <Card elevation={0} padding={4} testID={testID} style={{ flexGrow: 1, flexBasis: '45%', minWidth: 150 }}>
      <View style={{ gap: theme.space[2] }}>
        <Icon name={icon} size={22} color="accentText" />
        <Text variant="bodyStrong" tabular>
          {title}
        </Text>
        <Text variant="footnote" color="textMuted">
          {caption}
        </Text>
      </View>
    </Card>
  );
}
