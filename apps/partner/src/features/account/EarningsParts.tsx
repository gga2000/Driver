import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { EarningsJobLine, EarningsPeriod, EarningsView } from '@driver/contracts';
import { Button, Card, Icon, Rule, StatusPill, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { jobsKey, VEHICLE_ICON } from '@/features/work/logic';
import { useStatus } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { CashMeter } from './CashMeter';
import { Glyph } from './Glyph';
import {
  bestBucket,
  breakdownRows,
  cashTruth,
  clockTime,
  componentLabel,
  componentsKey,
  dayMonth,
  isJob,
  nextTierCap,
  shortRef,
  weekdayName,
  type ChartBucket,
} from './logic';
import { color } from '@driver/design-tokens';

const CREAM = color.neutral[50];
/** "12%" in a left-to-right isolate so the sign stays after the digits inside Arabic. */
const pct = (n: number) => `\u2066${n}%\u2069`;

/**
 * Animates a whole number from 0 on first show, then between values (period switches): the total
 * "counts up" like a till. Reduced motion jumps straight there.
 */
export function useCountFrom(value: number, duration = 900): number {
  const theme = useTheme();
  const sv = useSharedValue(0);
  const [shown, setShown] = useState(theme.reduceMotion ? value : 0);
  useEffect(() => {
    if (theme.reduceMotion) {
      sv.value = value;
      setShown(value);
      return;
    }
    sv.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, duration, sv, theme.reduceMotion]);
  useAnimatedReaction(
    () => Math.round(sv.value),
    (v, prev) => {
      if (v !== prev) runOnJS(setShown)(v);
    },
  );
  return shown;
}

/** ‹ هالأسبوع › — earlier periods sit on the start side (time reads right to left in Arabic). */
export function PeriodNav({ label, onPrev, onNext, canNext, dark = false }: { label: string; onPrev: () => void; onNext: () => void; canNext: boolean; dark?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const fg = dark ? CREAM : theme.colors.text;
  const btn = (dir: 'prev' | 'next', enabled: boolean, onPress: () => void) => (
    <Pressable
      testID={`period-${dir}`}
      accessibilityRole="button"
      accessibilityLabel={t(dir === 'prev' ? 'partner.earn_prev' : 'partner.earn_next')}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(dark ? CREAM : color.neutral[900], pressed ? 0.16 : 0.08),
        opacity: enabled ? 1 : 0.3,
      })}
    >
      <Icon name={dir === 'prev' ? 'chevron-back' : 'chevron-forward'} size={18} color={fg} strokeWidth={2.4} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      {btn('prev', true, onPrev)}
      <Text testID="period-label" variant="label" weight={600} align="center" color={fg} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      {btn('next', canNext, onNext)}
    </View>
  );
}

/** The dark hero: range, the net total counting up, jobs and the change vs the previous period, the chart. */
export function EarningsHero({
  view,
  period,
  rangeLabel,
  prevLabel,
  prevNetIqd,
  onPrev,
  onNext,
  canNext,
  buckets,
  loading,
}: {
  view: EarningsView | undefined;
  period: EarningsPeriod;
  rangeLabel: string;
  prevLabel: string;
  prevNetIqd: number | null;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
  buckets: ChartBucket[];
  loading: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const net = view?.totals.netIqd ?? 0;
  const shown = useCountFrom(net);
  const jobs = view?.totals.jobs ?? 0;
  const change = prevNetIqd !== null && prevNetIqd > 0 ? Math.round(((net - prevNetIqd) / prevNetIqd) * 100) : null;
  const muted = withAlpha(CREAM, 0.66);
  return (
    <View
      testID="earnings-hero"
      style={{
        backgroundColor: theme.colors.text,
        borderRadius: theme.radius['2xl'],
        padding: theme.space[5],
        paddingBottom: theme.space[4],
        gap: theme.space[4],
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.22,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
        overflow: 'hidden',
      }}
    >
      <PeriodNav label={rangeLabel} onPrev={onPrev} onNext={onNext} canNext={canNext} dark />
      <View style={{ alignItems: 'center', gap: 2, opacity: loading ? 0.55 : 1 }}>
        <Text variant="footnote" color={muted}>
          {t('partner.earn_net_label')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text testID="earnings-total" tabular weight={700} color={CREAM} style={{ fontSize: 46, lineHeight: 60, letterSpacing: -0.5 }}>
            {amountParam(shown)}
          </Text>
          <Text variant="title" color={muted}>
            {t('quote.currency')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap', justifyContent: 'center' }}>
          <Text variant="label" color={muted} tabular>
            {jobs > 0 ? t(jobsKey(jobs), { n: jobs }) : t('partner.earn_chart_empty')}
          </Text>
          {change !== null ? <ChangeChip change={change} prev={prevLabel} /> : null}
        </View>
      </View>
      <EarningsChart buckets={buckets} period={period} />
    </View>
  );
}

function ChangeChip({ change, prev }: { change: number; prev: string }) {
  const t = useT();
  const up = change > 2;
  const down = change < -2;
  const fg = up ? '#7ACF9D' : down ? '#F2BC68' : withAlpha(CREAM, 0.75);
  return (
    <View testID="earnings-change" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: withAlpha(CREAM, 0.08) }}>
      {up || down ? <Glyph name={up ? 'trend-up' : 'trend-down'} size={14} color={fg} strokeWidth={2.4} /> : null}
      <Text variant="caption" weight={600} color={fg} tabular>
        {up ? t('partner.earn_vs_up', { percent: pct(change), prev }) : down ? t('partner.earn_vs_down', { percent: pct(-change), prev }) : t('partner.earn_vs_same', { prev })}
      </Text>
    </View>
  );
}

const CHART_H = 112;

/** Bars of earnings per hour / day; tap a bar for its amount. The best one is named under the chart. */
export function EarningsChart({ buckets, period }: { buckets: ChartBucket[]; period: EarningsPeriod }) {
  const theme = useTheme();
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.amountIqd));
  const best = bestBucket(buckets);
  const grow = useSharedValue(0);
  const dataKey = buckets.map((b) => `${b.key}:${b.amountIqd}`).join('|');
  useEffect(() => {
    setSelected(null);
    grow.value = 0;
    grow.value = theme.reduceMotion ? 1 : withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) });
  }, [dataKey, grow, theme.reduceMotion]);

  const sel = buckets.find((b) => b.key === selected) ?? null;
  const focus = sel ?? best;
  const tickEvery = period === 'day' ? 3 : period === 'month' ? 5 : 1;
  const caption = sel
    ? t('partner.earn_chart_selected', { label: sel.label, amount: amountParam(sel.amountIqd), jobs: t(jobsKey(sel.jobs), { n: sel.jobs }) })
    : best
      ? period === 'day'
        ? t('partner.earn_chart_best_hour', { hour: best.label, amount: amountParam(best.amountIqd) })
        : t('partner.earn_chart_best', { day: best.label, amount: amountParam(best.amountIqd) })
      : t('partner.earn_chart_empty');

  return (
    <View testID="earnings-chart" style={{ gap: theme.space[2] }}>
      <View style={{ height: CHART_H, flexDirection: 'row', alignItems: 'flex-end', gap: period === 'month' ? 2 : period === 'day' ? 3 : 8 }}>
        {[0.33, 0.66, 1].map((g) => (
          <View key={g} pointerEvents="none" style={{ position: 'absolute', start: 0, end: 0, bottom: CHART_H * g - 1, height: 1, backgroundColor: withAlpha(CREAM, 0.06) }} />
        ))}
        {buckets.map((b) => (
          <Bar
            key={b.key}
            share={b.amountIqd / max}
            grow={grow}
            active={focus?.key === b.key}
            dim={sel !== null && sel.key !== b.key}
            onPress={() => {
              theme.haptic('selection');
              setSelected((s) => (s === b.key ? null : b.key));
            }}
            label={`${b.label} ${amountParam(b.amountIqd)}`}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: period === 'month' ? 2 : period === 'day' ? 3 : 8 }}>
        {buckets.map((b, i) => (
          <View key={b.key} style={{ flex: 1, alignItems: 'center', overflow: 'visible' }}>
            {i % tickEvery === 0 || (period === 'month' && i === buckets.length - 1 && i % tickEvery > 2) ? (
              <Text variant="caption" align="center" color={focus?.key === b.key ? CREAM : withAlpha(CREAM, 0.5)} tabular style={{ fontSize: period === 'week' ? 11 : 10, lineHeight: 14, width: 34 }}>
                {b.tick}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <Animated.View key={caption} entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {best && !sel ? <Icon name="star" size={13} color={theme.colors.accent} filled /> : null}
        <Text testID="earnings-chart-caption" variant="caption" weight={600} color={withAlpha(CREAM, 0.85)} tabular align="center">
          {caption}
        </Text>
      </Animated.View>
    </View>
  );
}

function Bar({ share, grow, active, dim, onPress, label }: { share: number; grow: { value: number }; active: boolean; dim: boolean; onPress: () => void; label: string }) {
  const theme = useTheme();
  const h = share > 0 ? Math.max(6, share * (CHART_H - 8)) : 3;
  const style = useAnimatedStyle(() => ({ height: Math.max(3, h * grow.value) }), [h]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, height: CHART_H, justifyContent: 'flex-end' }}>
      <Animated.View
        style={[
          {
            borderTopLeftRadius: 5,
            borderTopRightRadius: 5,
            borderBottomLeftRadius: 2,
            borderBottomRightRadius: 2,
            backgroundColor: share <= 0 ? withAlpha(CREAM, 0.12) : active ? color.primary[300] : theme.colors.accent,
            opacity: dim ? 0.35 : 1,
          },
          style,
        ]}
      />
    </Pressable>
  );
}

/** "من وين إجاك الربح": a proportion strip and the named totals, take shown openly. */
export function BreakdownCard({ totals }: { totals: EarningsView['totals'] }) {
  const theme = useTheme();
  const t = useT();
  const rows = breakdownRows(totals);
  const parts = [
    { v: totals.grossIqd, c: theme.colors.accent },
    { v: totals.tipsIqd, c: theme.colors.success },
    { v: totals.bonusesIqd, c: theme.colors.info },
    { v: totals.guaranteeTopUpsIqd, c: color.primary[700] },
  ].filter((p) => p.v > 0);
  const sum = parts.reduce((s, p) => s + p.v, 0);
  const dot: Record<string, string> = {
    'partner.earn_gross': theme.colors.accent,
    'partner.earn_tips': theme.colors.success,
    'partner.earn_bonuses': theme.colors.info,
    'partner.earn_guarantee': color.primary[700],
  };
  return (
    <Card testID="earnings-breakdown" elevation={1} padding={5}>
      <View style={{ gap: theme.space[4] }}>
        <Text variant="title">{t('partner.earn_breakdown_title')}</Text>
        {sum > 0 ? (
          <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
            {parts.map((p, i) => (
              <View key={i} style={{ flex: p.v / sum, backgroundColor: p.c }} />
            ))}
          </View>
        ) : null}
        <View style={{ gap: theme.space[2] }}>
          {rows.map((r) =>
            r.strong ? (
              <View key={r.key} style={{ gap: theme.space[2] }}>
                <Rule kind="dashed" />
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text variant="bodyStrong">{t(r.key)}</Text>
                  <Text variant="title" tabular>{`${amountParam(r.amountIqd)} ${t('quote.currency')}`}</Text>
                </View>
              </View>
            ) : (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot[r.key] ?? theme.colors.borderStrong }} />
                <Text variant="body" color="textMuted" style={{ flex: 1 }}>
                  {t(r.key)}
                </Text>
                <Text variant="body" weight={600} tabular color={r.amountIqd < 0 ? 'textMuted' : 'text'}>
                  {amountParam(r.amountIqd, { sign: r.amountIqd > 0 && r.key !== 'partner.earn_gross' })}
                </Text>
              </View>
            ),
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * The cash card (money & ops §4, P-05): one "لازم تسلّم" number — what counts against the cap — as the
 * hero, the bar and colour from it (amber from 70 %, red from 90 %), what he holds as the explanation,
 * when offers stop, today's cash movement, and the hand-over CTA (primary once he is near or over).
 */
export function CashCapCard({ view, onHandover, period, rangeLabel }: { view: EarningsView; onHandover: () => void; period?: boolean; rangeLabel?: string }) {
  const theme = useTheme();
  const t = useT();
  const { cap, cash } = view;
  const truth = cashTruth({ owedIqd: cap.owedIqd, heldIqd: cash.heldIqd, capIqd: cap.capIqd, overCap: cap.overCap });
  const next = nextTierCap(cap);
  const urgent = truth.tone !== 'success';
  return (
    <Card testID="cash-cap-card" elevation={1} padding={5} style={urgent ? { borderWidth: 1.5, borderColor: withAlpha(theme.colors[truth.tone], 0.45) } : undefined}>
      <View style={{ gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="title">{t('partner.cashcap_title')}</Text>
          <StatusPill size="sm" tone={cap.tier === 'gold' ? 'accent' : cap.tier === 'silver' ? 'info' : 'neutral'} icon="star" label={t(`partner.tier_${cap.tier}`)} />
        </View>
        <CashMeter owedIqd={cap.owedIqd} heldIqd={cash.heldIqd} capIqd={cap.capIqd} overCap={cap.overCap} size="hero" testID="cash-card-meter" />
        {period !== false ? (
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: theme.space[2] }}>
            {rangeLabel ? (
              <Text variant="caption" weight={600} color="textMuted">
                {`${t('partner.cash_period_title')} · ${rangeLabel}`}
              </Text>
            ) : null}
            <CashRow label={t('partner.cash_collected_period')} amount={cash.collectedIqd} />
            <CashRow label={t('partner.cash_to_merchants')} amount={-cash.toMerchantsIqd} />
            <CashRow label={t('partner.cash_settled')} amount={-cash.settledIqd} />
          </View>
        ) : null}
        <Button testID="handover-cta" label={t('partner.handover_cta')} icon="wallet" variant={urgent ? 'primary' : 'secondary'} fullWidth onPress={onHandover} />
        {next ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('partner.cash_next_tier', { tier: t(`partner.tier_${next.tier}`), amount: amountParam(next.capIqd) })}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function CashRow({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="footnote" color="textMuted">
        {label}
      </Text>
      <Text variant="footnote" weight={600} tabular>
        {amountParam(amount)}
      </Text>
    </View>
  );
}

/**
 * One job of the period: when, what it paid (net, signed), the components in one line, the cash he
 * took; tap to open every component with its amount and the cash note.
 */
export function JobLine({ job, withDay, expanded, onToggle, divider, icon = 'bike' }: { job: EarningsJobLine; withDay: boolean; expanded: boolean; onToggle: () => void; divider: boolean; icon?: IconName }) {
  const theme = useTheme();
  const t = useT();
  const real = isJob(job);
  const title = !real
    ? job.components[0]
      ? componentLabel(job.components[0], t)
      : t('partner.earn_job_adjustment')
    : withDay
      ? t('partner.earn_job_title_day', { day: weekdayName(job.at, t), time: clockTime(job.at) })
      : t('partner.earn_job_title', { time: clockTime(job.at) });
  const names = [...new Set(job.components.map((c) => componentLabel(c, t)))];
  const summary = !real
    ? withDay
      ? `${weekdayName(job.at, t)} ${dayMonth(job.at, t)} · ${clockTime(job.at)}`
      : clockTime(job.at)
    : names.length <= 2
      ? names.join(' · ')
      : `${names.slice(0, 2).join(' · ')} · ${t(componentsKey(names.length - 2), { n: names.length - 2 })}`;
  const rot = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(expanded ? 1 : 0, { duration: 180 });
  }, [expanded, rot]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 180}deg` }] }));
  return (
    <View testID={`job-line-${shortRef(job.key)}`} style={{ borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          theme.haptic('selection');
          onToggle();
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], paddingHorizontal: theme.space[4], backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' })}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: real ? theme.colors.accentTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          {real ? <Icon name={icon} size={20} color="accentText" strokeWidth={2} /> : <Icon name="gift" size={20} color="textMuted" strokeWidth={2} />}
        </View>
        <View style={{ flex: 1, gap: 0 }}>
          <Text variant="label" weight={600} tabular numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="bodyStrong" tabular color={job.netIqd < 0 ? 'dangerText' : 'text'}>
            {amountParam(job.netIqd, { sign: true })}
          </Text>
          {job.cashCollectedIqd > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.warningTint, borderRadius: 6, paddingHorizontal: 6 }}>
              <Icon name="wallet" size={11} color="warningText" strokeWidth={2.2} />
              <Text variant="caption" color="warningText" tabular style={{ fontSize: 11, lineHeight: 18 }}>
                {amountParam(job.cashCollectedIqd)}
              </Text>
            </View>
          ) : null}
        </View>
        <Animated.View style={chevron}>
          <Icon name="chevron-down" size={18} color="textMuted" strokeWidth={2.2} />
        </Animated.View>
      </Pressable>
      {expanded ? (
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4], gap: theme.space[2] }}>
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: theme.space[2] }}>
            {job.components.map((c, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
                <Text variant="footnote" color="text" style={{ flex: 1 }}>
                  {componentLabel(c, t)}
                </Text>
                <Text variant="footnote" weight={600} tabular color={c.amountIqd < 0 ? 'dangerText' : c.type === 'tip' || c.type === 'driver_incentive' ? 'successText' : 'text'}>
                  {amountParam(c.amountIqd, { sign: true })}
                </Text>
              </View>
            ))}
            <Rule kind="dotted" />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="footnote" weight={600}>
                {t('partner.earn_job_net')}
              </Text>
              <Text variant="footnote" weight={700} tabular>
                {`${amountParam(job.netIqd)} ${t('quote.currency')}`}
              </Text>
            </View>
          </View>
          {job.cashCollectedIqd > 0 ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <Icon name="wallet" size={16} color="warningText" strokeWidth={2.2} style={{ marginTop: 3 }} />
              <View style={{ flex: 1 }}>
                <Text variant="footnote" weight={600} color="warningText" tabular>
                  {t('partner.earn_job_cash', { amount: amountParam(job.cashCollectedIqd) })}
                </Text>
                <Text variant="caption" color="text">
                  {t('partner.earn_job_cash_note')}
                </Text>
              </View>
            </View>
          ) : null}
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.earn_job_ref', { ref: shortRef(job.tripId ?? job.orderId ?? job.key) })}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** The jobs of a period in one card; one open at a time. */
export function JobList({ jobs, withDay, testID }: { jobs: EarningsJobLine[]; withDay: boolean; testID?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const vehicle = useStatus().data?.vehicleClass ?? 'bike';
  return (
    <Card testID={testID} elevation={1} padding={0} style={{ overflow: 'hidden' }}>
      {jobs.map((j, i) => (
        <JobLine key={j.key} job={j} icon={VEHICLE_ICON[vehicle]} withDay={withDay} expanded={open === j.key} onToggle={() => setOpen((o) => (o === j.key ? null : j.key))} divider={i < jobs.length - 1} />
      ))}
    </Card>
  );
}
