import { useMemo } from 'react';
import { View } from 'react-native';
import { Card, Icon, Text, useTheme } from '@driver/ui';
import { dataHourlySince, megabytes, packsFor, useDataUsedSince } from '@/lib/data-usage';
import { useT } from '@/lib/i18n';
import { clockTime, startOfLocalDay } from './logic';

/**
 * «النت اللي صرفه التطبيق» (partner redesign l6): this shift's internet while he is online (from when
 * he went online), today's since midnight while he is off. Above the data saver, which cuts it.
 */
export function DataUseCard({ onlineSince }: { onlineSince: Date | null }) {
  const theme = useTheme();
  const t = useT();
  const from = useMemo(() => onlineSince ?? startOfLocalDay(new Date()), [onlineSince]);
  const bytes = useDataUsedSince(from);
  const hours = bytes == null ? [] : dataHourlySince(from.getTime());
  const packs = onlineSince && bytes != null ? packsFor(bytes, Date.now() - onlineSince.getTime()) : null;
  return (
    <Card elevation={0} padding={4} testID="data-use">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 40, height: 40, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="wifi" size={22} color="text" strokeWidth={2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" weight={700}>
              {t('partner.data_use_title')}
            </Text>
            <Text variant="label" color="textMuted" tabular>
              {onlineSince ? t('partner.data_use_shift', { time: clockTime(onlineSince) }) : t('partner.data_use_today')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space[4] }}>
          <Text testID="data-use-mb" variant="heading" weight={700} tabular style={{ flexShrink: 1 }}>
            {bytes == null ? '—' : t('partner.data_use_mb', { n: megabytes(bytes).toFixed(1) })}
          </Text>
          {hours.length > 1 ? <HourBars hours={hours} /> : null}
        </View>
        {packs ? (
          <Text testID="data-use-packs" variant="body" weight={600} tabular>
            {t('partner.data_use_packs', { n: packs })}
          </Text>
        ) : null}
        <Text variant="footnote" color="textMuted">
          {t('partner.data_use_hint')}
        </Text>
      </View>
    </Card>
  );
}

/** One small bar per hour, oldest at the start (the right, in Arabic); the hour still running is lighter. */
function HourBars({ hours }: { hours: number[] }) {
  const theme = useTheme();
  const top = Math.max(...hours, 1);
  return (
    <View testID="data-use-bars" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 36 }}>
      {hours.map((b, i) => (
        <View
          key={i}
          style={{
            width: 7,
            height: Math.max(3, Math.round((b / top) * 36)),
            borderRadius: 2,
            backgroundColor: i === hours.length - 1 ? theme.colors.accentTint : theme.colors.accent,
          }}
        />
      ))}
    </View>
  );
}

/** The shift summary's one line: «صرف التطبيق حوالي 3.4 ميغا نت بهالشفت». */
export function ShiftDataLine({ from }: { from: Date | null }) {
  const t = useT();
  const bytes = useDataUsedSince(from);
  if (bytes == null || bytes <= 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="shift-data">
      <Icon name="wifi" size={16} color="textMuted" strokeWidth={2} />
      <Text variant="footnote" color="textMuted" tabular style={{ flex: 1 }}>
        {t('partner.data_use_shift_line', { n: megabytes(bytes).toFixed(1) })}
      </Text>
    </View>
  );
}
