import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { PartnerCash, PartnerDemand, VehicleClass } from '@driver/contracts';
import { Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { capShare, driversKey, inZone, todayKey, VEHICLE_ICON, VEHICLE_KEY, waitingKey } from './logic';

/** Floating pill over the map: "12,500 · 6 طلبات" — taps through to الأرباح. */
export function TodayPill({ earningsIqd, jobs }: { earningsIqd: number; jobs: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="today-pill"
      accessibilityRole="button"
      onPress={() => router.navigate('/earnings')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        alignSelf: 'center',
        backgroundColor: theme.colors.text,
        borderRadius: theme.radius.pill,
        paddingStart: theme.space[2],
        paddingEnd: theme.space[4],
        height: 44,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="wallet" size={16} color="onAccent" strokeWidth={2.2} />
      </View>
      <Text variant="button" color="surface" tabular>
        {t(todayKey(jobs), { amount: amountParam(earningsIqd), n: jobs })}
      </Text>
    </Pressable>
  );
}

/** Round floating chip with the vehicle he's working on today. */
export function VehicleChip({ vehicle }: { vehicle: VehicleClass }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="vehicle-chip"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.pill,
        paddingHorizontal: theme.space[3],
        height: 36,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Icon name={VEHICLE_ICON[vehicle]} size={18} color="text" strokeWidth={2} />
      <Text variant="label" weight={600}>
        {t(VEHICLE_KEY[vehicle])}
      </Text>
    </View>
  );
}

/**
 * Cash in hand vs the cap (money & ops §4). The bar is what counts against the cap (held cash net
 * of what the platform owes him); amber from 80 %, red over the cap with the settle message.
 */
export function CashBar({ cash }: { cash: PartnerCash }) {
  const theme = useTheme();
  const t = useT();
  // The bar is cash in hand against the cap (what the driver counts); warnings follow the server's
  // cap maths (held cash net of what the platform owes him).
  const share = capShare(cash.heldIqd, cash.capIqd);
  const tone = cash.overCap ? theme.colors.danger : cash.nearCap ? theme.colors.warning : theme.colors.success;
  const note = cash.overCap ? t('partner.cash_cap_reached') : cash.nearCap ? t('partner.cap_warning', { percent: Math.round(capShare(cash.owedIqd, cash.capIqd) * 100) }) : null;
  return (
    <View testID="cash-bar" style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text variant="label" color="textMuted">
          {t('partner.cash_held')}
        </Text>
        <Text variant="label" weight={600} tabular>
          {t('partner.cash_of_cap', { held: amountParam(cash.heldIqd), cap: amountParam(cash.capIqd) })}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        {share > 0 ? <View style={{ height: 8, borderRadius: 4, backgroundColor: tone, width: `${Math.max(share * 100, 3)}%` }} /> : null}
      </View>
      {note ? (
        <Text variant="footnote" color={cash.overCap ? 'dangerText' : 'warningText'}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** "الطلب عالي بالمركز" — where the jobs are right now. */
export function DemandRow({ demand }: { demand: PartnerDemand }) {
  const theme = useTheme();
  const t = useT();
  const where = demand.zoneId ? inZone(demand.zoneId, t) : '';
  const high = demand.level === 'high';
  const title =
    demand.level === 'quiet' ? t('partner.demand_quiet') : high ? t('partner.demand_high', { where }) : t('partner.demand_normal', { where });
  const icon: IconName = high ? 'bell' : demand.level === 'quiet' ? 'clock' : 'map-pin';
  return (
    <View
      testID="demand-row"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        backgroundColor: high ? theme.colors.accentTint : theme.colors.surfaceSunken,
        borderRadius: theme.radius.lg,
        padding: theme.space[3],
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: high ? theme.colors.accent : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={high ? 'onAccent' : 'textMuted'} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 0 }}>
        <Text variant="label" weight={600} color={high ? 'accentText' : 'text'}>
          {title}
        </Text>
        {demand.level !== 'quiet' ? (
          <Text variant="caption" color="textMuted" tabular>
            {`${t(waitingKey(demand.waitingJobs), { n: demand.waitingJobs })} · ${t(driversKey(demand.driversNearby), { n: demand.driversNearby })}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Entry card for the intercity garage board / today's khat run (wave-2 routes). */
export function ModeCard({ icon, title, body, cta, href, testID }: { icon: IconName; title: string; body: string; cta: string; href: '/intercity' | '/khat'; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.infoTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color="infoText" strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {body}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Text variant="caption" weight={600} color="accentText">
          {cta}
        </Text>
        <Icon name="chevron-forward" size={16} color="accentText" strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

/** Shown on home while a job is open: back to the job in one tap. */
export function ActiveJobBanner() {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="active-job-banner"
      accessibilityRole="button"
      onPress={() => router.push('/job')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.text }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.success, marginStart: theme.space[1] }} />
      <Text variant="label" weight={600} color="surface" style={{ flex: 1 }}>
        {t('partner.active_job')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: withAlpha('#FFFFFF', 0.14), borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 4 }}>
        <Text variant="label" weight={600} color="surface">
          {t('partner.active_job_open')}
        </Text>
        <Icon name="chevron-forward" size={16} color="surface" strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}
