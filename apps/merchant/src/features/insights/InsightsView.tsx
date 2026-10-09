import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { MerchantInsights } from '@driver/contracts';
import { Icon, SegmentedControl, Skeleton, Text, useTheme } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Meter, Panel, PanelRow, Tag } from '@/components/Panel';
import { useDates } from '@/lib/dates';
import { useLayout } from '@/lib/layout';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { HourBars, Heatmap, Ring, TrendBars } from './Charts';
import { bestSellerRows, busiestWindow, canRankBySales, percent, prepVerdict, ratingTone, rejectionTrend, rejectionVerdict, type BestSellerMode, type Verdict } from './logic';

const VERDICT: Record<Verdict, { fg: 'successText' | 'warningText' | 'dangerText' | 'textMuted'; bg: 'successTint' | 'warningTint' | 'dangerTint' | 'surfaceSunken'; dot: 'success' | 'warning' | 'danger' | 'textMuted'; icon: MIconName }> = {
  good: { fg: 'successText', bg: 'successTint', dot: 'success', icon: 'check' },
  watch: { fg: 'warningText', bg: 'warningTint', dot: 'warning', icon: 'clock' },
  bad: { fg: 'dangerText', bg: 'dangerTint', dot: 'danger', icon: 'flame' },
  none: { fg: 'textMuted', bg: 'surfaceSunken', dot: 'textMuted', icon: 'chart' },
};

/** الإحصائيات: prep honesty, rejections with trend, peak hours, best sellers, item ratings with review text. */
export function InsightsView({ data, wide }: { data: MerchantInsights | undefined; wide: boolean }) {
  const theme = useTheme();
  if (!data) {
    return (
      <View style={{ gap: theme.space[4] }}>
        <Skeleton height={240} radius={20} />
        <Skeleton height={300} radius={20} />
      </View>
    );
  }
  const row = (a: ReactNode, b: ReactNode, ratio = [1, 1]) =>
    wide ? (
      <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'stretch' }}>
        <View style={{ flex: ratio[0] }}>{a}</View>
        <View style={{ flex: ratio[1] }}>{b}</View>
      </View>
    ) : (
      <>
        {a}
        {b}
      </>
    );
  return (
    <View style={{ gap: wide ? theme.space[5] : theme.space[4] }}>
      {row(<PrepPanel data={data} />, <RejectionPanel data={data} />, [1.15, 1])}
      <PeakPanel data={data} wide={wide} />
      {row(<BestSellersPanel data={data} />, <RatingsPanel data={data} />)}
    </View>
  );
}

function Verdict({ tone, text }: { tone: Verdict; text: string }) {
  const theme = useTheme();
  const v = VERDICT[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors[v.bg], borderRadius: theme.radius.lg, paddingVertical: theme.space[3], paddingHorizontal: theme.space[3] }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors[v.dot], alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name={v.icon} size={16} color="surface" strokeWidth={2.6} />
      </View>
      <Text variant="bodyStrong" color={v.fg} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function PrepPanel({ data }: { data: MerchantInsights }) {
  const theme = useTheme();
  const t = useT();
  const fill = useLayout().wide ? { flex: 1 } : undefined;
  const p = data.prepHonesty;
  const v = prepVerdict(p);
  if (v.kind === 'none') {
    return (
      <Panel title={t('merchant.insights.prep_title')} icon="clock" style={fill} testID="insights-prep">
        <Text variant="body" color="textMuted">
          {t('merchant.insights.no_data')}
        </Text>
      </Panel>
    );
  }
  const quoted = p.quotedAvgMin!;
  const actual = p.actualAvgMin!;
  const max = Math.max(quoted, actual) * 1.1;
  const headline =
    v.kind === 'late'
      ? t('merchant.insights.prep_late', { minutes: v.gapMin })
      : v.kind === 'uneven'
        ? t('merchant.insights.prep_uneven', { percent: Math.round((1 - (p.onTimeShare ?? 0)) * 100) })
        : v.kind === 'early'
          ? t('merchant.insights.prep_early', { minutes: v.gapMin })
          : t('merchant.insights.prep_honest');
  const advice = v.kind === 'late' || v.kind === 'uneven' ? t('merchant.insights.prep_advice_late') : v.kind === 'early' ? t('merchant.insights.prep_advice_early') : t('merchant.insights.prep_advice_honest');
  const share = p.onTimeShare ?? 0;
  const ringTone = share >= 0.8 ? theme.colors.success : share >= 0.6 ? theme.colors.warning : theme.colors.danger;
  const bar = (label: string, minutes: number, fill: string, strong: boolean) => (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="label" color="textMuted">
          {label}
        </Text>
        <Text weight={700} tabular style={{ fontSize: strong ? 24 : 20, lineHeight: strong ? 32 : 28 }} color={strong ? 'text' : 'textMuted'}>
          {t('merchant.common.minutes', { minutes: Math.round(minutes) })}
        </Text>
      </View>
      <Meter value={minutes / max} color={fill} height={14} />
    </View>
  );
  return (
    <Panel title={t('merchant.insights.prep_title')} caption={t('merchant.insights.prep_samples', { count: p.samples })} icon="clock" style={fill} testID="insights-prep">
      <Verdict tone={v.tone} text={headline} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[5] }}>
        <View style={{ flex: 1, gap: theme.space[3] }}>
          {bar(t('merchant.insights.prep_quoted'), quoted, theme.colors.borderStrong, false)}
          {bar(t('merchant.insights.prep_actual'), actual, v.kind === 'late' || v.kind === 'uneven' ? theme.colors.warning : theme.colors.success, true)}
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <View style={{ width: 104, height: 104, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute' }}>
              <Ring value={share} size={104} stroke={11} tone={ringTone} />
            </View>
            <Text weight={700} tabular style={{ fontSize: 24, lineHeight: 30 }}>
              {`${Math.round(share * 100)}%`}
            </Text>
          </View>
          <Text variant="caption" color="textMuted" align="center">
            {t('merchant.insights.prep_on_time')}
          </Text>
        </View>
      </View>
      <Text variant="footnote" color="textMuted">
        {advice}
      </Text>
    </Panel>
  );
}

function RejectionPanel({ data }: { data: MerchantInsights }) {
  const theme = useTheme();
  const t = useT();
  const fill = useLayout().wide ? { flex: 1 } : undefined;
  const dates = useDates();
  const r = data.rejection;
  const v = rejectionVerdict(r.rate);
  const trend = rejectionTrend(r.trend);
  const tone = theme.colors[VERDICT[v].dot];
  return (
    <Panel title={t('merchant.insights.reject_title')} caption={t('merchant.insights.reject_count', { rejected: r.rejected, offered: r.offered })} icon="x" style={fill} testID="insights-reject">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
        <Text variant="numeralMd" color={VERDICT[v].fg} testID="reject-rate">
          {r.rate === null ? '—' : `${percent(r.rate)}%`}
        </Text>
        {trend ? (
          <View style={{ paddingBottom: theme.space[2] }}>
            <Tag
              label={t(trend === 'down' ? 'merchant.insights.trend_down' : trend === 'up' ? 'merchant.insights.trend_up' : 'merchant.insights.trend_flat')}
              tone={trend === 'down' ? 'success' : trend === 'up' ? 'danger' : 'neutral'}
              icon={trend === 'flat' ? undefined : trend === 'down' ? 'chevron-down' : 'arrow-forward'}
            />
          </View>
        ) : null}
      </View>
      <Text variant="footnote" color={VERDICT[v].fg} weight={600}>
        {v === 'good' ? t('merchant.insights.reject_good') : v === 'watch' ? t('merchant.insights.reject_watch_honest', { percent: r.offered > 0 ? Math.round(((r.offered - r.rejected) / r.offered) * 100) : 0 }) : v === 'bad' ? t('merchant.insights.reject_bad') : t('merchant.insights.no_data')}
      </Text>
      {r.trend.length > 1 ? <TrendBars values={r.trend.map((b) => b.rate)} labels={r.trend.map((b) => dates.dayMonth(b.from))} tone={tone} /> : null}
    </Panel>
  );
}

function PeakPanel({ data, wide }: { data: MerchantInsights; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const w = busiestWindow(data.peakHours);
  return (
    <Panel
      title={t('merchant.insights.peak_title')}
      caption={w ? t('merchant.insights.peak_busiest', { from: dates.hour(w.from), to: dates.hour(w.to) }) : t('merchant.insights.no_data')}
      icon="flame"
      testID="insights-peak"
      aside={w ? <Tag label={t('merchant.insights.peak_orders', { count: w.orders })} tone="accent" /> : null}
    >
      {wide && data.peakGrid.length === 7 ? <Heatmap grid={data.peakGrid} hours={data.peakHours} /> : <HourBars hours={data.peakHours} highlight={w} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <MIcon name="people" size={16} color="textMuted" />
        <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
          {t('merchant.insights.peak_hint')}
        </Text>
      </View>
    </Panel>
  );
}

function BestSellersPanel({ data }: { data: MerchantInsights }) {
  const theme = useTheme();
  const t = useT();
  const fill = useLayout().wide ? { flex: 1 } : undefined;
  const locale = useLocale();
  // M-13: the rank and the bar use the same measure — count by default, money for owners who switch.
  const [mode, setMode] = useState<BestSellerMode>('qty');
  const bySales = canRankBySales(data.bestSellers);
  const rows = bestSellerRows(data.bestSellers, bySales ? mode : 'qty');
  return (
    <Panel title={bySales && mode === 'sales' ? t('merchant.insights.best_title_sales') : t('merchant.insights.best_title')} icon="utensils" flush style={fill} testID="insights-best">
      {bySales ? (
        <View style={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[2] }}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            accessibilityLabel={t('merchant.insights.best_title')}
            options={[
              { value: 'qty', label: t('merchant.insights.best_by_qty') },
              { value: 'sales', label: t('merchant.insights.best_by_sales') },
            ]}
          />
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
          {t('merchant.insights.no_data')}
        </Text>
      ) : (
        rows.map((b, i) => (
          <PanelRow key={b.itemId} first={i === 0 && !bySales}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: i === 0 ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label" weight={700} color={i === 0 ? 'onAccent' : 'textMuted'} tabular>
                {String(i + 1)}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {b.nameAr ?? '—'}
                </Text>
                <Text variant="label" weight={600} tabular>
                  {bySales && mode === 'sales' && b.salesIqd !== null ? iqd(b.salesIqd, { locale }) : t('merchant.insights.best_qty', { qty: b.qty })}
                </Text>
              </View>
              <Meter value={b.share} color={i === 0 ? theme.colors.accent : theme.colors.warning} height={6} />
              {b.salesIqd !== null ? (
                <Text variant="caption" color="textMuted" tabular>
                  {mode === 'sales' ? t('merchant.insights.best_qty', { qty: b.qty }) : iqd(b.salesIqd, { locale })}
                </Text>
              ) : null}
            </View>
          </PanelRow>
        ))
      )}
    </Panel>
  );
}

function Stars({ avg }: { avg: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Icon key={s} name="star" size={14} filled={avg >= s - 0.25} color={avg >= s - 0.25 ? 'accent' : 'border'} strokeWidth={1.6} />
      ))}
    </View>
  );
}

function RatingsPanel({ data }: { data: MerchantInsights }) {
  const theme = useTheme();
  const t = useT();
  const fill = useLayout().wide ? { flex: 1 } : undefined;
  return (
    <Panel title={t('merchant.insights.ratings_title')} caption={t('merchant.insights.ratings_hint')} icon="star" flush style={fill} testID="insights-ratings">
      {data.itemRatings.length === 0 ? (
        <Text variant="body" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
          {t('merchant.insights.ratings_none')}
        </Text>
      ) : (
        data.itemRatings.slice(0, 4).map((r, i) => {
          const tone = ratingTone(r.avg);
          return (
            <View key={r.itemId} style={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[3], gap: theme.space[2], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                  {r.nameAr ?? '—'}
                </Text>
                {tone === 'bad' ? <Tag label={t('merchant.insights.need_attention')} tone="danger" /> : null}
                <Text variant="bodyStrong" tabular color={VERDICT[tone].fg}>
                  {r.avg.toFixed(1)}
                </Text>
                <Stars avg={r.avg} />
              </View>
              <Text variant="caption" color="textMuted" tabular>
                {t('merchant.insights.ratings_count', { count: r.count })}
              </Text>
              {r.reviews.filter((rev, j, all) => all.findIndex((x) => x.note === rev.note) === j).slice(0, 1).map((rev, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3] }}>
                  <Text variant="caption" weight={700} color={rev.score <= 3 ? 'dangerText' : 'successText'} tabular>
                    {`${rev.score}/5`}
                  </Text>
                  <Text variant="footnote" style={{ flex: 1 }}>
                    {`"${rev.note}"`}
                  </Text>
                </View>
              ))}
            </View>
          );
        })
      )}
    </Panel>
  );
}
