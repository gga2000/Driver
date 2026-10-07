import { Pressable, ScrollView, View } from 'react-native';
import { stageOf, Text, useTheme } from '@driver/ui';
import { FoodArt, motifForCuisine } from '@/features/food/FoodArt';

/** The dish picture's diameter (discovery §6: 56–64 px illustrated circles). */
const DISH = 64;
/** Each circle's column: wide enough for a two-word label («تمن ومرق») under it. */
const COL = 72;

/**
 * Home's «شنو بخاطرك؟» row as round dish pictures (joy b6, discovery §6): one `FoodArt` circle per
 * cuisine word on its own coloured plate (Date & Saffron) with the word under it, so people pick by
 * the food, not by a text pill. Each opens search for that word. The whole column (≥ 44 px) is the
 * tap target.
 */
export function CuisineCircles({ cuisines, onPick }: { cuisines: readonly string[]; onPick: (word: string) => void }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -theme.space[5] }}
      contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[2] }}
      testID="home-cuisines"
    >
      {cuisines.map((c) => (
        <Pressable
          key={c}
          testID={`cuisine-${c}`}
          accessibilityRole="button"
          accessibilityLabel={c}
          onPress={() => {
            theme.haptic('selection');
            onPick(c);
          }}
          style={({ pressed }) => ({ width: COL, alignItems: 'center', gap: theme.space[1], transform: [{ scale: pressed ? 0.95 : 1 }] })}
        >
          <View
            style={{
              width: DISH,
              height: DISH,
              borderRadius: DISH / 2,
              overflow: 'hidden',
            }}
          >
            <FoodArt motif={motifForCuisine(c)} stage={stageOf(c, theme.decor.stages)} />
          </View>
          <Text variant="caption" weight={600} numberOfLines={1} align="center" compact>
            {c}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
