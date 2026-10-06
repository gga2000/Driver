import { useState } from 'react';
import { View } from 'react-native';
import type { MerchantDaySummary } from '@driver/contracts';
import { Button, Text, useTheme, useToast } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { useDates } from '@/lib/dates';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { adviceLine, dayFacts, dayTitleKey, type DayFact } from './logic';
import { shareDay } from './share';

export interface DaySummaryCardProps {
  summary: MerchantDaySummary;
  /** Baghdad local date of "now" (YYYY-MM-DD): "اليوم" vs "البارحة". */
  todayKey: string;
  wide: boolean;
  onDismiss: () => void;
}

const TONE = { text: 'text', danger: 'dangerText', success: 'successText', muted: 'textMuted' } as const;

/**
 * S-M6 · end of day. At close (or from 00:30 for the day that just ended) the board opens with the
 * day in one card: "اليوم: 42 طلب · فاتك 0 · وقتك مضبوط 91% · الصافي 512,000 دينار", one advice
 * line from Insights, "شارك على واتساب" (an image on the web, the share sheet on a phone) and "تمام".
 */
export function DaySummaryCard({ summary, todayKey, wide, onDismiss }: DaySummaryCardProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const dates = useDates();
  const [sharing, setSharing] = useState(false);
  const facts = dayFacts(summary);
  const advice = adviceLine(summary.advice);
  const title = t(dayTitleKey(summary, todayKey));
  const dayAt = new Date(`${summary.localDate}T12:00:00+03:00`);
  const dayName = `${dates.dow(dayAt.getUTCDay())} ${dates.dayMonth(dayAt)}`;
  const valueOf = (f: DayFact) => ('amountIqd' in f.value ? iqd(f.value.amountIqd, { locale }) : t(f.value.key, f.value.params));

  const share = async () => {
    setSharing(true);
    try {
      const r = await shareDay({
        text: summary.share_ar,
        fileName: `driver-${summary.localDate}.png`,
        card: {
          brand: t('merchant.app_name'),
          store: summary.storeName,
          title: `${title} · ${dayName}`,
          facts: facts.map((f) => ({ label: t(f.label), value: valueOf(f), tone: f.tone, ...(f.hero ? { hero: true } : {}) })),
          advice: advice ? t(advice.key, advice.params) : null,
          footer: summary.share_ar.split('\n').at(-1) ?? '',
        },
        colors: {
          bg: theme.colors.bg,
          surface: theme.colors.surface,
          text: theme.colors.text,
          muted: theme.colors.textMuted,
          border: theme.colors.border,
          accent: theme.colors.accent,
          success: theme.colors.successText,
          danger: theme.colors.dangerText,
        },
      });
      if (r === 'saved') toast.show({ message: t('merchant.day.saved'), tone: 'success', icon: 'check' });
    } catch {
      toast.show({ message: t('merchant.day.share_failed'), tone: 'warning' });
    } finally {
      setSharing(false);
    }
  };

  const small = facts.filter((f) => !f.hero);
  const hero = facts.find((f) => f.hero);
  return (
    <View
      testID="day-summary"
      accessible={false}
      style={{
        marginHorizontal: wide ? theme.space[5] : theme.space[4],
        marginTop: theme.space[4],
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius['2xl'],
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        padding: wide ? theme.space[5] : theme.space[4],
        gap: theme.space[4],
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[4], alignItems: wide ? 'center' : 'stretch' }}>
        <View style={{ flex: wide ? 1.1 : undefined, gap: 2 }}>
          <Text variant="label" color="textMuted" weight={600}>
            {t(summary.reason === 'day_end' ? 'merchant.day.kicker_day_end' : 'merchant.day.kicker_closed')}
          </Text>
          <Text variant="display" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {dayName}
          </Text>
        </View>
        <View style={{ flex: wide ? 3 : undefined, flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
          {small.map((f) => (
            <View key={f.key} testID={`day-${f.key}`} style={{ flexGrow: 1, flexBasis: wide ? 120 : 90, gap: 2, paddingVertical: theme.space[3], paddingHorizontal: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="caption" color="textMuted" weight={600} numberOfLines={1}>
                {t(f.label)}
              </Text>
              <Text variant="title" weight={700} tabular color={TONE[f.tone]} numberOfLines={1}>
                {valueOf(f)}
              </Text>
            </View>
          ))}
          {hero ? (
            <View testID="day-net" style={{ flexGrow: 2, flexBasis: wide ? 220 : '100%', gap: 0, paddingVertical: theme.space[2], paddingHorizontal: theme.space[4] }}>
              <Text variant="caption" color="textMuted" weight={600}>
                {t(hero.label)}
              </Text>
              <Text variant="numeralMd" tabular numberOfLines={1} style={{ letterSpacing: -0.5 }}>
                {valueOf(hero)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {advice ? (
        <View testID="day-advice" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint }}>
          <MIcon name="chart" size={20} color="accentText" strokeWidth={2} />
          <Text variant="body" weight={600} style={{ flex: 1 }}>
            {t(advice.key, advice.params)}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Button testID="day-ok" label={t('merchant.day.ok')} variant="secondary" size="lg" onPress={onDismiss} style={{ flex: 1 }} />
        <Button testID="day-share" label={t('merchant.day.share')} icon="share" size="lg" loading={sharing} onPress={() => void share()} style={{ flex: 2 }} />
      </View>
    </View>
  );
}
