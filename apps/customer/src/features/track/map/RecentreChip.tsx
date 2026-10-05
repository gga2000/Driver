import { View } from 'react-native';
import { color } from '@driver/design-tokens';
import { Chip, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** "رجّع الخريطة": shown once the person has moved the map; brings the follow camera back. */
export function RecentreChip({ bottom, onPress }: { bottom: number; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      style={{
        position: 'absolute',
        bottom,
        left: theme.space[4],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surface,
        shadowColor: color.neutral[1000],
        shadowOpacity: 0.14,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
      }}
    >
      <Chip label={t('track.recenter')} icon="location-arrow" onPress={onPress} testID="recenter" />
    </View>
  );
}
