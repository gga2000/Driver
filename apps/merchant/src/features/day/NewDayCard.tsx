import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Meter } from '@/components/Panel';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { NUMBERS_AFTER_ORDERS } from './logic';

/**
 * d20 · «يومك» before the first 10 orders: one friendly card instead of empty boxes, dashes and a blank
 * heat map — when the numbers come, what they will show, and how far along he is.
 */
export function NewDayCard({ done, wide }: { done: number; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="day-new"
      style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: theme.space[4], padding: theme.space[5], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: COUNTER.laneNew, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name="chart" size={28} color={COUNTER.newBadge} />
      </View>
      <View style={{ flex: wide ? 1 : undefined, gap: theme.space[2] }}>
        <Text variant="title" weight={700}>
          {t('merchant.daynew.title', { count: NUMBERS_AFTER_ORDERS })}
        </Text>
        <Text variant="body" color="textMuted">
          {t('merchant.daynew.body')}
        </Text>
      </View>
      <View style={{ minWidth: wide ? 240 : undefined, gap: theme.space[2] }}>
        <Meter value={done / NUMBERS_AFTER_ORDERS} color={theme.colors.accent} height={10} />
        <Text variant="label" weight={600} color="textMuted" tabular testID="day-new-count">
          {t('merchant.daynew.count', { done, count: NUMBERS_AFTER_ORDERS })}
        </Text>
      </View>
    </View>
  );
}
