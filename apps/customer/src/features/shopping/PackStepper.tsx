import { View } from 'react-native';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * Bread is sold in the bakery's own lots («4 بـ 1,000»): + and − move a whole lot, the middle shows
 * the pieces. `packs` is the number of lots.
 */
export function PackStepper({
  packs,
  per,
  onChange,
  max = 25,
  label,
}: {
  packs: number;
  per: number;
  onChange: (packs: number) => void;
  max?: number;
  label: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: t('shopping.pieces', { n: packs * per }) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(
          Math.max(0, Math.min(max, packs + (e.nativeEvent.actionName === 'increment' ? 1 : -1))),
        )
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        padding: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      <IconButton
        icon="minus"
        size={44}
        variant="plain"
        accessibilityLabel={t('ui.decrease')}
        disabled={packs <= 0}
        onPress={() => onChange(packs - 1)}
      />
      <Text variant="bodyStrong" weight={700} tabular style={{ minWidth: 28, textAlign: 'center' }}>
        {packs * per}
      </Text>
      <IconButton
        icon="plus"
        size={44}
        variant="plain"
        accessibilityLabel={t('ui.increase')}
        disabled={packs >= max}
        onPress={() => onChange(packs + 1)}
      />
    </View>
  );
}
