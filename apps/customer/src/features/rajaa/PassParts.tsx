import { View } from 'react-native';
import { formatMinutes } from '@driver/i18n';
import { Card, Icon, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { clockLabel, RAJAA_RULES } from './logic';
import { lateStageAt, type LateSegment, type LateStage, leaveHome } from './pass';
import type { LatLngLike } from './logic';

/**
 * Boarding-pass parts (Baghdad/Kut ideas t4, t6, Ali 2026-10-07): when to leave home for the garage,
 * and what being late costs as a bar with its times instead of a paragraph.
 */

/** t4: «اطلع من البيت 6:38» until it is time, then «اطلع هسة»; gone once the arrive-by time passes. */
export function LeaveHomeCard({ home, garage, departAt, now }: { home: LatLngLike; garage: LatLngLike; departAt: Date; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const { rideMin, leaveAt, arriveBy } = leaveHome(home, garage, departAt);
  if (now >= arriveBy) return null;
  const go = now >= leaveAt;
  return (
    <Card testID="rajaa-leave-home" tone={go ? 'tint' : 'surface'} elevation={0} padding={4}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} accessible accessibilityLiveRegion={go ? 'polite' : 'none'}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: go ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="home" size={22} color={go ? 'onAccent' : 'textMuted'} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} tabular>
            {go ? t('rajaa.leave_now') : t('rajaa.leave_at', { time: clockLabel(leaveAt) })}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('rajaa.leave_body', { time: clockLabel(arriveBy), duration: formatMinutes(rideMin, { locale }) })}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const STAGE_COLOR: Record<LateStage, 'success' | 'warning' | 'danger'> = { grace: 'success', meter: 'warning', gone: 'danger' };
const STAGE_ICON: Record<LateStage, IconName> = { grace: 'check', meter: 'clock', gone: 'x' };

/**
 * t6: grace → meter → the car leaves, as one coloured bar with the time each starts. The stage the
 * clock is in now is marked «هسة». The whole rule is still read out in full to a screen reader.
 */
export function LateBar({ stages, prepaid, now, a11y }: { stages: readonly LateSegment[]; prepaid: boolean; now: Date; a11y: string }) {
  const theme = useTheme();
  const t = useT();
  const current = lateStageAt(stages, now);
  // Bar widths follow the minutes; the open-ended last stage gets a fixed share.
  const weight = (s: LateSegment) => (s.to ? Math.max(1, (s.to.getTime() - s.from.getTime()) / 60_000) : 8);
  const label = (s: LateSegment) =>
    s.stage === 'grace'
      ? t('rajaa.late_grace')
      : s.stage === 'meter'
        ? t('rajaa.late_meter', { amount: amountParam(RAJAA_RULES.riderLateToDriverPerBlockIqd) })
        : prepaid
          ? t('rajaa.late_gone_wallet')
          : t('rajaa.late_gone_cash');
  return (
    <View testID="rajaa-late-bar" accessible accessibilityLabel={a11y} style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={700}>
        {t('rajaa.late_title')}
      </Text>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {stages.map((s) => (
          <View key={s.stage} style={{ flex: weight(s), height: 10, borderRadius: 5, backgroundColor: theme.colors[STAGE_COLOR[s.stage]], opacity: current && current !== s.stage ? 0.35 : 1 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {stages.map((s) => (
          <View key={s.stage} style={{ flex: weight(s), gap: 2, minWidth: 0 }}>
            <Text variant="caption" weight={700} tabular numberOfLines={1}>
              {clockLabel(s.from)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 3 }}>
              <Icon name={STAGE_ICON[s.stage]} size={12} color={`${STAGE_COLOR[s.stage]}Text`} strokeWidth={2.4} style={{ marginTop: 3 }} />
              <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                {label(s)}
              </Text>
            </View>
            {current === s.stage ? <StatusPill size="sm" tone={STAGE_COLOR[s.stage]} live label={t('rajaa.late_now')} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}
