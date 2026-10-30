import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { EarningsPeriod, EarningsView } from '@driver/contracts';
import { Button, Card, EmptyState, SegmentedControl, Skeleton, StatusPill, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DriverAvatar, PlateBadge, SectionHeader, TierPill, VehicleGlyph } from '@/features/fleet/FleetParts';
import { cashTone, CLASS_KEY, DOCS_STATUS_KEY, DOW_KEY, dowOf, localDateKey, maskedPhone, STATE_KEY, STATE_TONE } from '@/features/fleet/logic';
import { useDriverEarnings, useFleetOverview } from '@/features/fleet/queries';
import { baghdadClock } from '@/features/ops/logic';
import { capShare, jobsKey } from '@/features/work/logic';
import { apiErrorMessage } from '@/lib/api';
import { componentLabel } from '@/features/account/logic';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

/**
 * One fleet driver: who he is, his vehicle and documents, then his earnings for the day / week /
 * month (`fleet.driverEarnings`) with every component named, the cash he holds against his cap,
 * and each job.
 */
export default function FleetDriverDetail() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [period, setPeriod] = useState<EarningsPeriod>('week');
  const o = useFleetOverview().data;
  const d = o?.drivers.find((x) => x.driverId === id);
  // A pending invite has no earnings to read (driver_not_in_fleet) until the driver accepts.
  const e = useDriverEarnings(d && !d.pending ? (id ?? '') : '', period);
  const v = d?.vehicleId ? o?.vehicles.find((x) => x.vehicleId === d.vehicleId) : undefined;
  const title = d?.name ?? t('partner.hub_fleet');

  return (
    <Screen edges={['bottom']} testID="fleet-driver">
      <Stack.Screen options={{ title }} />
      {d?.pending ? (
        <EmptyState
          icon="clock"
          title={t('partner.fleet_pending_title')}
          body={t('partner.fleet_pending_hint')}
          style={{ paddingTop: theme.space[8] }}
        />
      ) : null}
      {d?.pending ? null : !d ? (
        <Skeleton lines={4} />
      ) : (
        <Card elevation={1} padding={4}>
          <View style={{ gap: theme.space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <DriverAvatar name={d.name} state={d.state} size={60} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title">{d.name ?? maskedPhone(d.phoneMasked)}</Text>
                <Text variant="label" color="textMuted" tabular>
                  {maskedPhone(d.phoneMasked)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusPill size="sm" dot label={t(STATE_KEY[d.state])} tone={STATE_TONE[d.state] === 'accent' ? 'neutral' : STATE_TONE[d.state]} />
                <TierPill tier={d.tier} />
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: theme.colors.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              {v ? (
                <>
                  <VehicleGlyph vehicleClass={v.vehicleClass} size={36} />
                  <Text variant="label">{t(CLASS_KEY[v.vehicleClass])}</Text>
                  <PlateBadge plate={v.plate} />
                </>
              ) : (
                <Text variant="label" color="textMuted">
                  {t('partner.fleet_no_vehicle')}
                </Text>
              )}
              <View style={{ flex: 1 }} />
              <Text variant="caption" color={d.documents === 'expired' || d.documents === 'rejected' ? 'dangerText' : d.documents === 'expiring' ? 'warningText' : 'textMuted'}>
                {d.documents ? t(DOCS_STATUS_KEY[d.documents]) : t('partner.fleet_docs_none')}
              </Text>
            </View>
          </View>
        </Card>
      )}

      {d?.pending ? null : (
        <SegmentedControl
          accessibilityLabel={t('partner.fleet_jobs_title')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'day', label: t('partner.fleet_period_day') },
            { value: 'week', label: t('partner.fleet_period_week') },
            { value: 'month', label: t('partner.fleet_period_month') },
          ]}
        />
      )}

      {d?.pending ? null : e.isError && !e.data ? (
        <EmptyState
          icon="wallet"
          title={apiErrorMessage(e.error, t('error.network'), locale)}
          action={{ label: t('action.retry'), onPress: () => void e.refetch() }}
        />
      ) : !e.data ? (
        <Skeleton height={220} radius={20} />
      ) : (
        <Earnings view={e.data} />
      )}
    </Screen>
  );
}

function Earnings({ view }: { view: EarningsView }) {
  const theme = useTheme();
  const t = useT();
  const tt = view.totals;
  const lines: Array<[string, number]> = [
    [t('partner.fleet_gross'), tt.grossIqd],
    [t('partner.fleet_take'), -tt.takeIqd],
    [t('partner.fleet_tips'), tt.tipsIqd],
    [t('partner.fleet_bonuses'), tt.bonusesIqd],
    [t('partner.fleet_guarantee'), tt.guaranteeTopUpsIqd],
    [t('partner.fleet_penalties'), -tt.penaltiesIqd],
  ];
  const share = capShare(view.cash.heldIqd, view.cap.capIqd);
  const tone = cashTone(view.cash.heldIqd, view.cap.capIqd, view.cap.overCap);

  return (
    <>
      <Card elevation={1} padding={4} testID="fleet-driver-earnings">
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text variant="label" color="textMuted">
                {t('partner.fleet_net')}
              </Text>
              <Text variant="amount" tabular>
                {iqd(tt.netIqd)}
              </Text>
            </View>
            {tt.jobs > 0 ? <StatusPill size="sm" icon="bag" label={t(jobsKey(tt.jobs), { n: tt.jobs })} tone="neutral" /> : null}
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border }} />
          {lines
            .filter(([, amount], i) => i < 2 || amount !== 0)
            .map(([label, amount]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="label" color="textMuted">
                  {label}
                </Text>
                <Text variant="label" weight={600} tabular color={amount < 0 ? 'textMuted' : 'text'}>
                  {amountParam(amount)}
                </Text>
              </View>
            ))}
        </View>
      </Card>

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.fleet_cash_title')} />
        <Card elevation={0} padding={4}>
          <View style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              {(
                [
                  [t('partner.fleet_cash_held'), view.cash.heldIqd],
                  [t('partner.fleet_owed'), view.cash.owedIqd],
                  [t('partner.fleet_cap'), view.cap.capIqd],
                ] as const
              ).map(([label, amount]) => (
                <View key={label} style={{ flex: 1, gap: 2 }}>
                  <Text variant="caption" color="textMuted">
                    {label}
                  </Text>
                  <Text variant="bodyStrong" weight={700} tabular>
                    {amountParam(amount)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
              {share > 0 ? <View style={{ height: 8, borderRadius: 4, width: `${Math.max(share * 100, 3)}%`, backgroundColor: theme.colors[tone] }} /> : null}
            </View>
          </View>
        </Card>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('partner.fleet_jobs_title')} />
        {view.jobs.length === 0 ? (
          <Card elevation={0}>
            <Text variant="body" color="textMuted" align="center">
              {t('partner.fleet_no_jobs')}
            </Text>
          </Card>
        ) : (
          <JobList view={view} />
        )}
      </View>
    </>
  );
}

const JOBS_FIRST = 12;

/** Jobs newest first, grouped by Baghdad day (day name · jobs · total), one compact row each. */
function JobList({ view }: { view: EarningsView }) {
  const theme = useTheme();
  const t = useT();
  const [all, setAll] = useState(false);
  const sorted = [...view.jobs].sort((a, b) => b.at.getTime() - a.at.getTime());
  const shown = all ? sorted : sorted.slice(0, JOBS_FIRST);
  const days = new Map<string, typeof sorted>();
  for (const j of shown) {
    const k = localDateKey(j.at);
    days.set(k, [...(days.get(k) ?? []), j]);
  }
  const totals = new Map<string, { n: number; net: number }>();
  for (const j of sorted) {
    const k = localDateKey(j.at);
    const x = totals.get(k) ?? { n: 0, net: 0 };
    totals.set(k, { n: x.n + 1, net: x.net + j.netIqd });
  }
  const today = localDateKey(new Date());
  return (
    <View style={{ gap: theme.space[3] }}>
      {[...days.entries()].map(([day, jobs]) => {
        const tot = totals.get(day)!;
        return (
          <Card key={day} elevation={0} padding={0}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="label" weight={600}>
                {`${day === today ? t('partner.fleet_chart_today') : t(DOW_KEY[dowOf(day)]!)} · ${t(jobsKey(tot.n), { n: tot.n })}`}
              </Text>
              <Text variant="label" weight={700} tabular>
                {iqd(tot.net)}
              </Text>
            </View>
            {jobs.map((j, i) => (
              <View key={j.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
                <Text variant="label" color="textMuted" tabular style={{ width: 64 }}>
                  {baghdadClock(j.at)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text variant="footnote" color="textMuted" tabular numberOfLines={2}>
                    {j.components.map((c) => `${componentLabel(c, t)} ${amountParam(c.amountIqd, { sign: c.amountIqd < 0 })}`).join(' · ')}
                  </Text>
                  {j.cashCollectedIqd > 0 ? (
                    <Text variant="caption" color="warningText" tabular>
                      {t('partner.fleet_job_cash', { amount: amountParam(j.cashCollectedIqd) })}
                    </Text>
                  ) : null}
                </View>
                <Text variant="label" weight={700} tabular>
                  {amountParam(j.netIqd)}
                </Text>
              </View>
            ))}
          </Card>
        );
      })}
      {sorted.length > JOBS_FIRST && !all ? (
        <Button testID="fleet-jobs-all" label={`${t('action.see_all')} · ${sorted.length}`} variant="secondary" fullWidth onPress={() => setAll(true)} />
      ) : null}
    </View>
  );
}
