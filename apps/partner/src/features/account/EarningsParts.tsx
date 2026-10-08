import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { orderTicketNumber, type ComplimentKey, type EarningsJobLine, type EarningsPeriod, type EarningsView, type MyBestView } from '@driver/contracts';
import { Button, Card, Icon, Rule, StatusPill, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { jobsKey, VEHICLE_ICON } from '@/features/work/logic';
import { useStatus } from '@/features/work/queries';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { CashMeter } from './CashMeter';
import { useCompliments } from './queries';
import {
  bestBucket,
  breakdownRows,
  cashTruth,
  clockTime,
  componentLabel,
  componentsKey,
  dayMonth,
  isJob,
  jobTipIqd,
  bestWindowLabel,
  nextTierCap,
  shortRef,
  weekdayName,
  type ChartBucket,
} from './logic';
import { color } from '@driver/design-tokens';

const CREAM = color.neutral[50];

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

/**
 * The earnings hero on the cream page (partner redesign e1): range, the net counting up, the jobs, then
 * his own week and his best day (e4: never "less than yesterday"), and the chart.
 */
export function EarningsHero({
  view,
  period,
  rangeLabel,
  onPrev,
  onNext,
  canNext,
  buckets,
  loading,
  best,
}: {
  view: EarningsView | undefined;
  period: EarningsPeriod;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
  buckets: ChartBucket[];
  loading: boolean;
  best?: MyBestView | undefined;
}) {
  const theme = useTheme();
  const t = useT();
  const net = view?.totals.netIqd ?? 0;
  const shown = useCountFrom(net);
  const jobs = view?.totals.jobs ?? 0;
  // This week's tile only on the day view (the week view already is the week).
  const week = period === 'day' && best && best.week.jobs > 0 ? best.week : null;
  const bestDay = best?.bestDay ?? null;
  return (
    <View
      testID="earnings-hero"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius['2xl'],
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.space[5],
        paddingBottom: theme.space[4],
        gap: theme.space[4],
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      }}
    >
      <PeriodNav label={rangeLabel} onPrev={onPrev} onNext={onNext} canNext={canNext} />
      <View style={{ alignItems: 'center', gap: 2, opacity: loading ? 0.55 : 1 }}>
        <Text variant="footnote" color="textMuted">
          {t('partner.earn_net_label')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text testID="earnings-total" variant="numeralLg" style={{ letterSpacing: -0.5 }}>
            {amountParam(shown)}
          </Text>
          <Text variant="title" color="textMuted">
            {t('quote.currency')}
          </Text>
        </View>
        <Text variant="label" color="textMuted" tabular>
          {jobs > 0 ? t(jobsKey(jobs), { n: jobs }) : t('partner.earn_chart_empty')}
        </Text>
      </View>
      {week || bestDay ? (
        <View testID="earnings-mybest" style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {week ? <MiniStat testID="earnings-week-so-far" label={t('partner.e5_week_so_far')} amount={week.netIqd} sub={t(jobsKey(week.jobs), { n: week.jobs })} /> : null}
          {bestDay ? (
            <MiniStat testID="earnings-best-day" star label={t('partner.e5_best_day')} amount={bestDay.netIqd} sub={`${weekdayName(bestDay.at, t)} ${dayMonth(bestDay.at, t)}`} />
          ) : null}
        </View>
      ) : null}
      <EarningsChart buckets={buckets} period={period} />
    </View>
  );
}

/** A small tile in the hero: what it is, the amount, one line under it. */
function MiniStat({ label, amount, sub, star = false, testID }: { label: string; amount: number; sub: string; star?: boolean; testID: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ flex: 1, gap: 2, padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: star ? theme.colors.accentTint : theme.colors.surfaceSunken }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {star ? <Icon name="star" size={13} color="accentText" filled fillColor="accentText" /> : null}
        <Text variant="caption" weight={600} color={star ? 'accentText' : 'textMuted'} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text variant="bodyStrong" tabular numberOfLines={1}>
        {`${amountParam(amount)} ${t('quote.currency')}`}
      </Text>
      <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
        {sub}
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
          <View key={g} pointerEvents="none" style={{ position: 'absolute', start: 0, end: 0, bottom: CHART_H * g - 1, height: 1, backgroundColor: theme.colors.border }} />
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
              <Text variant="caption" align="center" color={focus?.key === b.key ? 'text' : 'textMuted'} tabular style={{ fontSize: period === 'week' ? 11 : 10, lineHeight: 14, width: 34 }}>
                {b.tick}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <Animated.View key={caption} entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {best && !sel ? <Icon name="star" size={13} color="accentText" filled fillColor="accentText" /> : null}
        <Text testID="earnings-chart-caption" variant="caption" weight={600} color="textMuted" tabular align="center">
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
            backgroundColor: share <= 0 ? theme.colors.surfaceSunken : active ? theme.colors.accentText : theme.colors.accent,
            opacity: dim ? 0.35 : 1,
          },
          style,
        ]}
      />
    </Pressable>
  );
}

/**
 * «أحسن وقت إلك» (partner redesign e3): the weekday hours that paid him most in the last four weeks,
 * from his own jobs, and what they paid on average per hour. History, not a promise; until there is a
 * habit to read, one quiet line says when it will show.
 */
export function BestTimeCard({ best }: { best: MyBestView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const w = best.bestWindow;
  if (!w) {
    return (
      <Card testID="best-time-empty" elevation={0} padding={4} tone="sunken">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Icon name="clock" size={18} color="textMuted" strokeWidth={2.2} />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('partner.e5_best_time_soon')}
          </Text>
        </View>
      </Card>
    );
  }
  return (
    <Card testID="best-time" elevation={1} padding={5}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="clock" size={26} color="accentText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" color="textMuted">
            {t('partner.e5_best_time')}
          </Text>
          <Text testID="best-time-label" variant="title" weight={700} tabular>
            {bestWindowLabel(w, t, locale)}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {t('partner.e5_best_time_sub', { weeks: Math.round(best.sinceDays / 7), amount: amountParam(w.perHourIqd) })}
          </Text>
        </View>
      </View>
    </Card>
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
 * took; tap a job to open its receipt (every line with its reason, audit S-7), an adjustment to open
 * its line in place.
 */
export function JobLine({ job, withDay, expanded, onToggle, divider, icon = 'bike', words = [] }: { job: EarningsJobLine; withDay: boolean; expanded: boolean; onToggle: () => void; divider: boolean; icon?: IconName; words?: readonly ComplimentKey[] }) {
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
  const tip = jobTipIqd(job);
  const names = [...new Set(job.components.filter((c) => !(real && c.type === 'tip')).map((c) => componentLabel(c, t)))];
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
        accessibilityState={real ? undefined : { expanded }}
        accessibilityHint={real ? t('partner.receipt_open_a11y') : undefined}
        onPress={() => {
          theme.haptic('selection');
          // A job opens its receipt (audit S-7: every line with its reason, the take, the cash, "عندي اعتراض");
          // an adjustment has only its own line and opens in place.
          if (real) router.push({ pathname: '/earnings/receipt', params: { key: job.key, at: job.at.toISOString() } });
          else onToggle();
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
          {real && (tip > 0 || words.length > 0) ? <TipWords tipIqd={tip} words={words} /> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="bodyStrong" tabular color={job.netIqd < 0 ? 'dangerText' : 'text'}>
            {amountParam(job.netIqd, { sign: true })}
          </Text>
          {job.cashCollectedIqd > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.warningTint, borderRadius: 6, paddingHorizontal: 6 }}>
              <Icon name="wallet" size={11} color="warningText" strokeWidth={2.2} />
              <Text variant="caption" color="warningText" tabular style={{ lineHeight: 18 }}>
                {amountParam(job.cashCollectedIqd)}
              </Text>
            </View>
          ) : null}
        </View>
        {real ? (
          <Icon name="chevron-forward" size={18} color="textMuted" strokeWidth={2.2} />
        ) : (
          <Animated.View style={chevron}>
            <Icon name="chevron-down" size={18} color="textMuted" strokeWidth={2.2} />
          </Animated.View>
        )}
      </Pressable>
      {expanded && !real ? (
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

/**
 * Partner redesign e5: the tip in green, and beside it the words the customer picked for him on that
 * order («سريع» · «مؤدب»), matched by the order's ticket from «كلام الزبائن». Never who said them.
 */
function TipWords({ tipIqd, words }: { tipIqd: number; words: readonly ComplimentKey[] }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="job-tip-words" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {tipIqd > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, minHeight: 22, borderRadius: 11, backgroundColor: theme.colors.successTint }}>
          <Icon name="heart" size={11} color="successText" filled fillColor="successText" />
          <Text variant="caption" weight={700} color="successText" tabular style={{ lineHeight: 18 }}>
            {t('partner.e5_tip', { amount: amountParam(tipIqd) })}
          </Text>
        </View>
      ) : null}
      {words.length > 0 ? (
        <Text variant="caption" color="successText" numberOfLines={1} style={{ flexShrink: 1 }}>
          {words.map((w) => `«${t(`compliment.${w}`)}»`).join('، ')}
        </Text>
      ) : null}
    </View>
  );
}

/** The jobs of a period in one card; one open at a time. */
/**
 * Pass `open`/`onOpen` when the list sits in a recycled list (FlashList): the open row then lives with the
 * screen, not in a component another day's rows may reuse.
 */
export function JobList({ jobs, withDay, testID, open: openProp, onOpen }: { jobs: EarningsJobLine[]; withDay: boolean; testID?: string; open?: string | null; onOpen?: (key: string | null) => void }) {
  const [openOwn, setOpenOwn] = useState<string | null>(null);
  const open = onOpen ? (openProp ?? null) : openOwn;
  const setOpen = (next: (o: string | null) => string | null) => (onOpen ? onOpen(next(open)) : setOpenOwn(next));
  const vehicle = useStatus().data?.vehicleClass ?? 'bike';
  const words = useOrderWords();
  return (
    <Card testID={testID} elevation={1} padding={0} style={{ overflow: 'hidden' }}>
      {jobs.map((j, i) => (
        <JobLine key={j.key} job={j} words={j.orderId ? (words.get(orderTicketNumber(j.orderId)) ?? []) : []} icon={VEHICLE_ICON[vehicle]} withDay={withDay} expanded={open === j.key} onToggle={() => setOpen((o) => (o === j.key ? null : j.key))} divider={i < jobs.length - 1} />
      ))}
    </Card>
  );
}

/** «كلام الزبائن» by order ticket: the words each customer picked (latest ones, the server's list). */
function useOrderWords(): Map<string, readonly ComplimentKey[]> {
  const recent = useCompliments().data?.recent;
  return useMemo(() => new Map((recent ?? []).map((r) => [r.ticket, r.keys] as const)), [recent]);
}
