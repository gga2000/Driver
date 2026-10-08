import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { MessageKey } from '@driver/i18n';
import { Text, useTheme } from '@driver/ui';
import { distinctPhotos, photoForMotif } from '@/features/food-landing/photos';
import { countKey } from '@/lib/plural';
import { useT } from '@/lib/i18n';
import type { DoorCraving } from './cravings';

const TILE_W = 104;
const TILE_H = 124;

/**
 * «شنو بخاطرك؟» (ideas d5, k9, s6, j2): the things behind this door as pictures, each with how many open
 * shops have it now. One tap picks it (the best three for it show below), a second tap lets it go.
 * Real photos (Ali 2026-10-08, concept A): the name on the picture, the count under it, a saffron
 * ring on the picked one.
 */
export function CravingRow({
  row,
  selected,
  onSelect,
}: {
  row: readonly DoorCraving[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const photos = distinctPhotos(row.map((c) => c.kind.art));
  const ink = theme.colors.inverse;
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
        contentContainerStyle={{
          paddingHorizontal: theme.space[5],
          gap: theme.space[3],
          paddingVertical: theme.space[1],
        }}
        accessibilityRole="radiogroup"
      >
        {row.map(({ kind, dishes }, i) => {
          const on = selected === kind.key;
          const photo = photos[i] ?? photoForMotif(kind.art);
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
              style={({ pressed }) => ({
                width: TILE_W,
                gap: 6,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <View
                style={{
                  width: TILE_W,
                  height: TILE_H,
                  borderRadius: theme.radius.xl,
                  overflow: 'hidden',
                  backgroundColor: ink,
                  borderWidth: on ? 3 : 0,
                  borderColor: theme.colors.accent,
                }}
              >
                <Image
                  source={photo}
                  resizeMode="cover"
                  accessible={false}
                  style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }}
                />
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <Svg width="100%" height="100%" preserveAspectRatio="none">
                    <Defs>
                      <LinearGradient id={`crave-${kind.key}`} x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0.4" stopColor={ink} stopOpacity={0} />
                        <Stop offset="1" stopColor={ink} stopOpacity={0.86} />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="100%" height="100%" fill={`url(#crave-${kind.key})`} />
                  </Svg>
                </View>
                <Text
                  weight={700}
                  color="onInverse"
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.2}
                  style={{
                    position: 'absolute',
                    bottom: theme.space[2],
                    start: theme.space[3],
                    end: theme.space[3],
                    fontSize: 15,
                    lineHeight: 21,
                  }}
                >
                  {name}
                </Text>
              </View>
              <Text
                variant="caption"
                color={on ? 'accentText' : 'textMuted'}
                weight={on ? 700 : 500}
                tabular
                numberOfLines={1}
              >
                {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
