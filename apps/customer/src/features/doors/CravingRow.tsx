import { Pressable, ScrollView, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import type { MessageKey } from '@driver/i18n';
import { DishDrawing, Text, useTheme } from '@driver/ui';
import { countKey } from '@/lib/plural';
import { useT } from '@/lib/i18n';
import type { DoorCraving } from './cravings';
import type { DoorSwatch } from './palette';

const SIZE = 68;

/**
 * «شنو بخاطرك؟» (ideas d5, k9, s6, j2): the things behind this door as pictures, each with how many open
 * shops have it now. One tap picks it (the best three for it show below), a second tap lets it go. The
 * picked picture sits on the door's own colour with a ring; the rest stay on paper.
 */
export function CravingRow({
  row,
  selected,
  onSelect,
  swatch,
}: {
  row: readonly DoorCraving[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  swatch: DoorSwatch;
}) {
  const theme = useTheme();
  const t = useT();
  if (row.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }} testID="craving-row">
      <View style={{ gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {t('food.craving_title')}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('food.craving_hint')}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -theme.space[5] }}
        contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[3], paddingVertical: theme.space[1] }}
        accessibilityRole="radiogroup"
      >
        {row.map(({ kind, dishes }) => {
          const on = selected === kind.key;
          const name = t(`food.craving.${kind.key}` as MessageKey);
          const count = t(countKey('food.craving_count', dishes.length), { n: dishes.length });
          return (
            <Pressable
              key={kind.key}
              testID={`craving-${kind.key}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t('food.craving_a11y', { name, count })}
              onPress={() => {
                theme.haptic('selection');
                onSelect(on ? null : kind.key);
              }}
              style={({ pressed }) => ({ width: SIZE + 8, alignItems: 'center', gap: 4, transform: [{ scale: pressed ? 0.95 : 1 }] })}
            >
              <View
                style={{
                  width: SIZE,
                  height: SIZE,
                  borderRadius: SIZE / 2,
                  overflow: 'hidden',
                  backgroundColor: on ? swatch.fill : theme.colors.surface,
                  borderWidth: on ? 3 : 1,
                  borderColor: on ? swatch.fill : theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ position: 'absolute', top: 4, start: 4, end: 4, bottom: 4, borderRadius: SIZE / 2, backgroundColor: on ? swatch.inner : 'transparent' }} />
                <Svg width={SIZE - 6} height={SIZE - 6} viewBox="0 0 200 200">
                  <G transform="translate(6 2) scale(0.94)">
                    <DishDrawing kind={kind.art} look={0} line={5} window={false} />
                  </G>
                </Svg>
              </View>
              <Text variant="caption" weight={on ? 700 : 600} align="center" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" color="textMuted" align="center" tabular numberOfLines={1} style={{ marginTop: -4 }}>
                {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
