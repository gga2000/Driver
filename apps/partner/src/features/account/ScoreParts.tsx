import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { AZIZIYAH_MONEY_RULES, type ScoreMetric, type ScoreNudge, type ScorecardView } from '@driver/contracts';
import { Card, Icon, StatusPill, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useCountFrom } from './EarningsParts';
import { Glyph } from './Glyph';
import { dayMonth, METRIC_DESC, METRIC_NAME, METRIC_PREVIEW, metricFormat, metricPos, nextTierProgress, observation } from './logic';

type Tier = 'bronze' | 'silver' | 'gold';

/** Medal colours: bronze, silver, gold — drawn, not text colours. */
const MEDAL: Record<Tier, { fill: string; ring: string; ink: string }> = {
  bronze: { fill: '#E7B48A', ring: '#B97A4A', ink: '#5E3416' },
  silver: { fill: '#E3E1DC', ring: '#A8A39A', ink: '#3F3B35' },
  gold: { fill: '#F6CF6A', ring: '#C9961F', ink: '#5A3F06' },
};

/** A round gauge: the share drawn as an arc from the top, the count in the middle. */
export function Gauge({ share, size = 132, stroke = 12, color, track, children }: { share: number; size?: number; stroke?: number; color: string; track: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${Math.max(0.001, share) * c} ${c}`} />
      </Svg>
      {children}
    </View>
  );
}

export function TierMedal({ tier, size = 28 }: { tier: Tier; size?: number }) {
  const m = MEDAL[tier];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: m.fill, borderWidth: 2, borderColor: m.ring, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="star" size={size * 0.5} color={m.ink} filled strokeWidth={1.5} />
    </View>
  );
}

/** Index gauge, tier, the window and what it takes to reach the next tier. */
export function ScoreHero({ card }: { card: ScorecardView }) {
  const theme = useTheme();
  const t = useT();
  const index = card.index ?? 0;
  const tier = (card.tier ?? 'bronze') as Tier;
  const shown = useCountFrom(index, 1000);
  const color = index >= 85 ? '#C9961F' : index >= 70 ? theme.colors.info : theme.colors.accent;
  const next = nextTierProgress(index, card.completedTrips);
  return (
    <Card testID="score-hero" elevation={2} padding={5}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[5] }}>
        <Gauge share={shown / 100} color={color} track={theme.colors.surfaceSunken}>
          <Text testID="score-index" tabular weight={700} style={{ fontSize: 40, lineHeight: 48 }}>
            {shown}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('partner.score_out_of')}
          </Text>
        </Gauge>
        <View style={{ flex: 1, gap: theme.space[2] }}>
          <Text variant="footnote" color="textMuted">
            {t('partner.score_index_label')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <TierMedal tier={tier} />
            <Text variant="title" weight={700}>
              {t(`partner.tier_${tier}`)}
            </Text>
          </View>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.score_window', { days: card.windowDays, trips: card.completedTrips })}
          </Text>
        </View>
      </View>
      <TierLadder tier={tier} index={index} />
      <Text variant="footnote" weight={600} color="accentText" align="center" style={{ marginTop: theme.space[3] }} tabular>
        {next ? t(next.key, { points: amountParam(next.points, { sign: true }), trips: card.completedTrips }) : t('partner.score_top')}
      </Text>
    </Card>
  );
}

/** Bronze < 70 · Silver 70–84 · Gold ≥ 85: three steps with their cash caps and a marker at his index. */
function TierLadder({ tier, index }: { tier: Tier; index: number }) {
  const theme = useTheme();
  const t = useT();
  const caps = AZIZIYAH_MONEY_RULES.caps.byRole.courier;
  const steps: { tier: Tier; from: number; to: number }[] = [
    { tier: 'bronze', from: 0, to: 70 },
    { tier: 'silver', from: 70, to: 85 },
    { tier: 'gold', from: 85, to: 100 },
  ];
  const pop = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!theme.reduceMotion) pop.value = withDelay(500, withTiming(1, { duration: 360, easing: Easing.out(Easing.back(2)) }));
  }, [pop, theme.reduceMotion]);
  const pos = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.4 + pop.value * 0.6 }] }));
  return (
    <View style={{ marginTop: theme.space[5], gap: theme.space[2] }}>
      <View style={{ height: 10, flexDirection: 'row', gap: 3 }}>
        {steps.map((s) => (
          <View key={s.tier} style={{ flex: s.to - s.from, borderRadius: 5, backgroundColor: s.tier === tier ? MEDAL[s.tier].ring : withAlpha(MEDAL[s.tier].ring, 0.28) }} />
        ))}
        <Animated.View style={[{ position: 'absolute', top: -5, start: `${Math.max(2, Math.min(98, index))}%`, width: 20, height: 20, marginStart: -10, borderRadius: 10, backgroundColor: theme.colors.surface, borderWidth: 3, borderColor: theme.colors.text }, pos]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {steps.map((s) => (
          <View key={s.tier} style={{ flex: s.to - s.from, alignItems: 'center' }}>
            <Text variant="caption" weight={s.tier === tier ? 700 : 500} color={s.tier === tier ? 'text' : 'textMuted'} numberOfLines={1}>
              {t(`partner.tier_${s.tier}`)}
            </Text>
            <Text variant="caption" color="textMuted" tabular numberOfLines={1} style={{ fontSize: 11, lineHeight: 16 }}>
              {amountParam(caps[s.tier])}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Same-evening nudges (scoring §1) with the date consequences would apply — never the same day. */
export function NudgesCard({ nudges, consequencesFrom }: { nudges: ScoreNudge[]; consequencesFrom: Date | null }) {
  const theme = useTheme();
  const t = useT();
  if (nudges.length === 0) {
    return (
      <Card testID="score-all-good" elevation={0} padding={4} style={{ backgroundColor: theme.colors.successTint, borderColor: 'transparent' }}>
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
          <Icon name="check" size={20} color="successText" strokeWidth={2.6} />
          <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
            {t('partner.score_all_good')}
          </Text>
        </View>
      </Card>
    );
  }
  return (
    <Card testID="score-nudges" elevation={0} padding={5} style={{ backgroundColor: theme.colors.accentTint, borderColor: 'transparent' }}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Glyph name="trend-up" size={20} color="accentText" strokeWidth={2.4} />
          <Text variant="title" color="accentText">
            {t('partner.score_nudges_title')}
          </Text>
        </View>
        {nudges.map((n) => (
          <View key={n.key} style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent, marginTop: 10 }} />
            <Text variant="body" style={{ flex: 1 }}>
              {n.message_ar}
            </Text>
          </View>
        ))}
        {consequencesFrom ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <Glyph name="calendar" size={16} color="textMuted" />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }} tabular>
              {t('partner.score_consequence', { date: dayMonth(consequencesFrom, t) })}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** One component: value against its target, with the Silver line as a tick on the same track. */
export function MetricRow({ m, divider }: { m: ScoreMetric; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const has = m.value !== null;
  const full = has && m.value! >= m.fullAt;
  const tone = !has ? theme.colors.borderStrong : m.belowSilver ? theme.colors.warning : full ? theme.colors.success : theme.colors.info;
  const fill = useSharedValue(0);
  useEffect(() => {
    const target = has ? metricPos(m, m.value!) : 0;
    fill.value = theme.reduceMotion ? target : withTiming(target, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [m, has, fill, theme.reduceMotion]);
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View testID={`metric-${m.key}`} style={{ paddingVertical: theme.space[4], gap: theme.space[2], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600}>
            {t(METRIC_NAME[m.key])}
          </Text>
          <Text variant="caption" color="textMuted" numberOfLines={2}>
            {t(METRIC_DESC[m.key])}
          </Text>
        </View>
        <Text variant="amount" tabular color={m.belowSilver ? 'warningText' : 'text'} style={{ fontSize: 24 }}>
          {has ? m.display : '—'}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceSunken, overflow: 'visible' }}>
        <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: tone }, bar]} />
        <View style={{ position: 'absolute', top: -3, height: 14, width: 2, borderRadius: 1, start: `${metricPos(m, m.silverLine) * 100}%`, backgroundColor: theme.colors.textMuted }} />
        <View style={{ position: 'absolute', top: -4, height: 16, width: 3, borderRadius: 1.5, start: `${metricPos(m, m.fullAt) * 100}%`, backgroundColor: theme.colors.success }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="caption" color="textMuted" tabular style={{ flex: 1 }}>
          {`${t('partner.score_target', { target: metricFormat(m.key, m.fullAt) })} · ${t('partner.score_line', { line: metricFormat(m.key, m.silverLine) })}${has ? ` · ${t('partner.score_samples', { n: m.samples })}` : ''}`}
        </Text>
        <StatusPill size="sm" tone={!has ? 'neutral' : m.belowSilver ? 'warning' : 'success'} label={!has ? t('partner.score_no_data') : m.belowSilver ? t('partner.score_below') : t('partner.score_ok')} />
      </View>
    </View>
  );
}

/** Month one: day n of 30 on a ring, when the card shows, and that nothing happens to him this month. */
export function ObservationCard({ card }: { card: ScorecardView }) {
  const theme = useTheme();
  const t = useT();
  const o = observation(card.dayNumber);
  const shown = useCountFrom(o.day, 900);
  return (
    <Card testID="score-observation" elevation={2} padding={5}>
      <View style={{ alignItems: 'center', gap: theme.space[4] }}>
        <Gauge share={shown / 30} size={148} stroke={12} color={theme.colors.accent} track={theme.colors.accentTint}>
          <Text variant="caption" color="textMuted">
            {t('partner.score_day_word')}
          </Text>
          <Text testID="score-day" tabular weight={700} style={{ fontSize: 44, lineHeight: 52 }}>
            {shown}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.score_of_30')}
          </Text>
        </Gauge>
        <StatusPill tone="accent" icon="clock" label={t('partner.score_days_left', { n: o.daysLeft })} style={{ alignSelf: 'center' }} />
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text testID="score-hidden-title" variant="heading" align="center">
            {t('partner.score_hidden_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('partner.score_hidden_body', { date: dayMonth(card.visibleFrom, t) })}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export function NoConsequenceNote() {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="score-no-consequence" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.successTint, borderRadius: theme.radius.xl, padding: theme.space[4] }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="shield" size={20} color="successText" strokeWidth={2.2} />
      </View>
      <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
        {t('partner.score_no_consequence')}
      </Text>
    </View>
  );
}

/** The five components and their targets, without values (month one). */
export function MetricPreview() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ paddingHorizontal: theme.space[1], gap: 2 }}>
        <Text variant="title">{t('partner.score_prepare_title')}</Text>
        <Text variant="footnote" color="textMuted">
          {t('partner.score_prepare_body')}
        </Text>
      </View>
      <Card elevation={1} padding={0}>
        {METRIC_PREVIEW.map((m, i) => (
          <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderBottomWidth: i < METRIC_PREVIEW.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" weight={700} tabular>
                {m.weight}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" weight={600}>
                {t(METRIC_NAME[m.key])}
              </Text>
              <Text variant="caption" color="textMuted">
                {t(METRIC_DESC[m.key])}
              </Text>
            </View>
            <Text variant="label" weight={600} color="accentText" tabular>
              {t('partner.score_target', { target: m.target })}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}
