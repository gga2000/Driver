import { forwardRef } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ShiftSummary } from '@driver/contracts';
import { Button, Card, Icon, Text, useTheme, type IconName } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { CashMeter } from '@/features/account/CashMeter';
import { Glyph } from '@/features/account/Glyph';
import { useCountFrom } from '@/features/account/EarningsParts';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { dayLine, shiftStats, tomorrowLine, type ShareCardModel } from './shift-logic';

/** Staggered entrance, skipped under reduced motion. */
function enter(reduceMotion: boolean, i: number) {
  return reduceMotion ? undefined : FadeInDown.delay(80 * i).duration(260);
}

/**
 * The shift's one big number (S-4): net counting up, per hour under it, the whole day when he had
 * more than one shift. An empty shift says so instead of showing a lonely 0.
 */
export function ShiftHero({ s }: { s: ShiftSummary }) {
  const theme = useTheme();
  const t = useT();
  const net = useCountFrom(s.netIqd, 1000);
  const day = dayLine(s, t);
  return (
    <Animated.View entering={enter(theme.reduceMotion, 0)}>
      <Card elevation={1} padding={5} testID="shift-hero">
        {s.jobs === 0 && s.netIqd === 0 ? (
          <View style={{ alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[2] }}>
            <Icon name="clock" size={28} color="textMuted" />
            <Text variant="title" align="center">
              {t('partner.shiftsum_empty')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" color="textMuted">
              {t('partner.shiftsum_net_label')}
            </Text>
            <View accessible accessibilityLabel={`${amountParam(s.netIqd)} ${t('quote.currency')}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="numeralMd" tabular testID="shift-net">
                {amountParam(net)}
              </Text>
              <Text variant="title" color="textMuted">
                {t('quote.currency')}
              </Text>
            </View>
            {s.perHourIqd !== null ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], paddingVertical: theme.space[1] }}>
                <Icon name="clock" size={16} color="accentText" />
                <Text testID="shift-per-hour" variant="label" weight={600} color="accentText" tabular>
                  {t('partner.shiftsum_per_hour', { amount: amountParam(s.perHourIqd) })}
                </Text>
              </View>
            ) : (
              <Text variant="footnote" color="textMuted">
                {t('partner.shiftsum_per_hour_short')}
              </Text>
            )}
            {day ? (
              <Text testID="shift-day" variant="footnote" color="textMuted" tabular>
                {day}
              </Text>
            ) : null}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

const STAT_ICON: Record<'jobs' | 'online' | 'tips' | 'best', IconName> = { jobs: 'bag', online: 'clock', tips: 'gift', best: 'star' };

/** Jobs, time online, tips, best hour: two to a row. */
export function ShiftStats({ s }: { s: ShiftSummary }) {
  const theme = useTheme();
  const t = useT();
  const stats = shiftStats(s, t);
  return (
    <Animated.View entering={enter(theme.reduceMotion, 1)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }} testID="shift-stats">
      {stats.map((x) => (
        <View
          key={x.key}
          accessible
          accessibilityLabel={`${x.label}: ${x.value}${x.sub ? `، ${x.sub}` : ''}`}
          style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[1] }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name={STAT_ICON[x.key]} size={16} color="textMuted" />
            <Text variant="caption" color="textMuted">
              {x.label}
            </Text>
          </View>
          <Text variant="title" weight={700} tabular>
            {x.value}
          </Text>
          {x.sub ? (
            <Text variant="caption" color="textMuted" tabular>
              {x.sub}
            </Text>
          ) : null}
        </View>
      ))}
    </Animated.View>
  );
}

/** Cash to hand over today, the same meter as home, and the code. */
export function ShiftCash({ s, onCode }: { s: ShiftSummary; onCode: () => void }) {
  const theme = useTheme();
  const t = useT();
  const owes = s.cash.owedIqd > 0;
  return (
    <Animated.View entering={enter(theme.reduceMotion, 2)}>
      <Card elevation={0} padding={4} testID="shift-cash">
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="wallet" size={18} color="text" />
            <Text variant="title">{t('partner.shiftsum_cash_title')}</Text>
          </View>
          {owes ? (
            <>
              <CashMeter owedIqd={s.cash.owedIqd} heldIqd={s.cash.heldIqd} capIqd={s.cash.capIqd} overCap={s.cash.overCap} testID="shift-cash-meter" />
              <Button testID="shift-code" label={t('partner.shiftsum_code_cta')} icon="receipt" variant={s.cash.overCap ? 'primary' : 'secondary'} fullWidth onPress={onCode} />
            </>
          ) : (
            <Text variant="body" color="textMuted">
              {t('partner.shiftsum_cash_none')}
            </Text>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}

/** Tomorrow's busiest two hours, from last week's same weekday. */
export function ShiftTomorrow({ s }: { s: ShiftSummary }) {
  const theme = useTheme();
  const t = useT();
  const line = tomorrowLine(s, t);
  if (!line) return null;
  return (
    <Animated.View entering={enter(theme.reduceMotion, 3)}>
      <Card elevation={0} padding={4} tone="sunken" testID="shift-tomorrow">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="calendar" size={20} color="accentText" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" color="textMuted">
              {t('partner.shiftsum_tomorrow_title')}
            </Text>
            <Text variant="label" weight={600} tabular>
              {line}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('partner.shiftsum_tomorrow_sub')}
            </Text>
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

/** The one scorecard nudge shift-end carries (never a list). */
export function ShiftNudge({ s, onOpen }: { s: ShiftSummary; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  if (!s.nudge) return null;
  return (
    <Animated.View entering={enter(theme.reduceMotion, 4)}>
      <Card elevation={0} padding={4} testID="shift-nudge" onPress={onOpen} accessibilityLabel={`${t('partner.shiftsum_nudge_title')}: ${s.nudge.message_ar}`}>
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <Icon name="star" size={20} color="accentText" style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <Text variant="label" weight={600}>
              {t('partner.shiftsum_nudge_title')}
            </Text>
            <Text variant="footnote">{s.nudge.message_ar}</Text>
            <Text variant="label" weight={600} color="accentText">
              {t('partner.shiftsum_nudge_cta')}
            </Text>
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * The picture "شارك يومك" sends on a phone (captured from this view; the web draws the same layout on
 * a canvas). Fixed 360×450 points (4:5), brand mark on top, the net as the one big number.
 */
export const ShareDayCard = forwardRef<View, { model: ShareCardModel }>(function ShareDayCard({ model }, ref) {
  const theme = useTheme();
  return (
    <View ref={ref} collapsable={false} style={{ width: 360, height: 450, backgroundColor: theme.colors.bg, padding: 28, gap: 14 }}>
      <Wordmark size="md" />
      <View style={{ gap: 2 }}>
        <Text variant="heading">{model.title}</Text>
        <Text variant="caption" color="textMuted">
          {model.date}
        </Text>
      </View>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 18, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text variant="numeralMd" tabular>
            {model.net}
          </Text>
          <Text variant="title" color="textMuted">
            {model.currency}
          </Text>
        </View>
        {model.perHour ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 2 }}>
            <Text variant="label" weight={600} color="accentText" tabular>
              {model.perHour}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {model.stats.slice(0, 3).map((x) => (
          <View key={x.label} style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" color="textMuted">
              {x.label}
            </Text>
            <Text variant="label" weight={700} tabular>
              {x.value}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ height: 3, backgroundColor: theme.colors.accent, borderRadius: 2 }} />
      <Text variant="caption" color="textMuted">
        {model.tag}
      </Text>
    </View>
  );
});
