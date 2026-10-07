import { Pressable, View } from 'react-native';
import type { MerchantDaySummary } from '@driver/contracts';
import { Skeleton, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { adviceLine, dayFacts, type DayFact } from './logic';

const TONE = { text: 'text', danger: 'dangerText', success: 'successText', muted: 'textMuted' } as const;

/**
 * The top of «يومك» (counter step 5, f1 f2): the day so far in a few numbers, the same ones as the
 * end-of-day card (orders, missed, on time and, for the owner, the net), its one advice line, and
 * «يحتاجك» when a complaint waits for an answer. Staff see the same numbers without the money.
 */
export function DayStrip({ summary, waiting, wide, onWaiting }: { summary: MerchantDaySummary | undefined; waiting: number; wide: boolean; onWaiting?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (!summary) return <Skeleton height={wide ? 110 : 190} radius={theme.radius.xl} />;
  const facts = dayFacts(summary);
  const advice = adviceLine(summary.advice);
  const valueOf = (f: DayFact) => ('amountIqd' in f.value ? iqd(f.value.amountIqd, { locale }) : t(f.value.key, f.value.params));
  return (
    <View testID="day-strip" style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        {facts.map((f) => (
          <View
            key={f.key}
            style={{
              flexBasis: wide ? 0 : '46%',
              flexGrow: f.hero ? 1.6 : 1,
              gap: 2,
              padding: theme.space[4],
              borderRadius: theme.radius.xl,
              backgroundColor: f.hero ? COUNTER.date : theme.colors.surface,
              borderWidth: f.hero ? 0 : 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text variant="label" color={f.hero ? undefined : 'textMuted'} style={f.hero ? { color: COUNTER.onDateMuted } : undefined}>
              {t(f.label)}
            </Text>
            <Text variant="numeralSm" tabular color={f.hero ? undefined : TONE[f.tone]} style={f.hero ? { color: COUNTER.onDate } : undefined} numberOfLines={1} adjustsFontSizeToFit>
              {valueOf(f)}
            </Text>
          </View>
        ))}
      </View>
      {waiting > 0 && onWaiting ? (
        <Pressable
          testID="day-needs-you"
          accessibilityRole="button"
          onPress={onWaiting}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.dangerTint, opacity: pressed ? 0.85 : 1 })}
        >
          <MIcon name="alert" size={20} color="dangerText" />
          <Text variant="bodyStrong" color="dangerText" style={{ flex: 1 }}>
            {t('merchant.dayscreen.needs_you', { count: waiting })}
          </Text>
          <MIcon name="chevron-forward" size={18} color="dangerText" />
        </Pressable>
      ) : null}
      {advice ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[2] }}>
          <MIcon name="bulb" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t(advice.key, advice.params)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
