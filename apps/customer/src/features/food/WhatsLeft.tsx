import { Card, Icon, SegmentedControl, Text, useTheme } from '@driver/ui';
import { View } from 'react-native';
import { useT } from '@/lib/i18n';

/**
 * «شنو باقي اليوم؟» on a menu where much is sold out (Ali, 2026-10-07): says how many dishes are gone and
 * how many are left, and switches the menu to only what can still be ordered.
 */
export function WhatsLeft({ soldOut, left, only, onChange }: { soldOut: number; left: number; only: boolean; onChange: (only: boolean) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={0} tone="sunken" padding={3} style={{ marginTop: theme.space[4], gap: theme.space[3] }} testID="whats-left">
      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
        <Icon name="clock" size={18} color="textMuted" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t('restaurant.whats_left_title')}
          </Text>
          <Text variant="footnote" color="textMuted" tabular testID="whats-left-line">
            {t('restaurant.whats_left_line', { count: soldOut, left })}
          </Text>
        </View>
      </View>
      <SegmentedControl
        options={[
          { value: 'all', label: t('restaurant.whats_left_all') },
          { value: 'only', label: t('restaurant.whats_left_only') },
        ]}
        value={only ? 'only' : 'all'}
        onChange={(v) => onChange(v === 'only')}
        accessibilityLabel={t('restaurant.whats_left_title')}
      />
    </Card>
  );
}
