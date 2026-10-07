import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { stageOf, Text, useTheme } from '@driver/ui';
import { FoodArt, motifForCuisine } from '@/features/food/FoodArt';

/** The dish picture's diameter (discovery §6: 56–64 px illustrated circles). */
const DISH = 64;
/** Each circle's column: wide enough for a two-word label («تمن ومرق») under it. */
const COL = 72;
/** The picked circle shows itself this long before the results open (0 under reduced motion). */
const PICK_LEAD_MS = 260;

type Look = 'rest' | 'picked' | 'other';

/**
 * Home's «شنو بخاطرك؟» row as round dish pictures (joy b6, discovery §6): one `FoodArt` circle per
 * cuisine word on its own coloured plate (Date & Saffron) with the word under it, so people pick by
 * the food, not by a text pill. Each opens search for that word. The whole column (≥ 44 px) is the
 * tap target. A tap answers first (Ali's Yes, "catpick", 2026-10-07): the picked circle lifts with an
 * ink ring, the others step back, then the results open; coming back finds the row at rest.
 */
export function CuisineCircles({ cuisines, onPick }: { cuisines: readonly string[]; onPick: (word: string) => void }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(
    useCallback(() => {
      setPicked(null);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }, []),
  );
  const pick = (c: string) => {
    if (picked) return;
    theme.haptic('selection');
    setPicked(c);
    if (theme.reduceMotion) onPick(c);
    else timer.current = setTimeout(() => onPick(c), PICK_LEAD_MS);
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Room above for the picked circle's lift and ring, mostly borrowed from the gap over the row.
      style={{ marginHorizontal: -theme.space[5], marginTop: -theme.space[2] }}
      contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[3], gap: theme.space[2] }}
      testID="home-cuisines"
    >
      {cuisines.map((c) => (
        <Circle key={c} word={c} look={picked === null ? 'rest' : picked === c ? 'picked' : 'other'} onPress={() => pick(c)} />
      ))}
    </ScrollView>
  );
}

function Circle({ word, look, onPress }: { word: string; look: Look; onPress: () => void }) {
  const theme = useTheme();
  const lift = useSharedValue(0);
  const dim = useSharedValue(1);
  useEffect(() => {
    const on = look === 'picked' ? 1 : 0;
    const fade = look === 'other' ? 0.45 : 1;
    lift.value = theme.reduceMotion ? on : withSpring(on, theme.motion.spring.select);
    dim.value = theme.reduceMotion ? fade : withTiming(fade, { duration: theme.motion.duration.fast });
  }, [look, lift, dim, theme.reduceMotion, theme.motion]);
  const column = useAnimatedStyle(() => ({ opacity: dim.value }));
  const plate = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * lift.value }, { scale: 1 + 0.06 * lift.value }] }));
  return (
    <Pressable
      testID={`cuisine-${word}`}
      accessibilityRole="button"
      accessibilityLabel={word}
      accessibilityState={{ selected: look === 'picked' }}
      onPress={onPress}
      style={({ pressed }) => ({ width: COL, alignItems: 'center', transform: [{ scale: pressed && look === 'rest' ? 0.95 : 1 }] })}
    >
      <Animated.View style={[{ alignItems: 'center', gap: theme.space[1] }, column]}>
        <Animated.View
          style={[
            {
              width: DISH,
              height: DISH,
              borderRadius: DISH / 2,
              // The ink ring: a cream gap, then a date-brown line.
              boxShadow: look === 'picked' ? `0px 0px 0px 3px ${theme.colors.bg}, 0px 0px 0px 5px ${theme.colors.text}` : undefined,
            },
            plate,
          ]}
        >
          <View style={{ flex: 1, borderRadius: DISH / 2, overflow: 'hidden' }}>
            <FoodArt motif={motifForCuisine(word)} stage={stageOf(word, theme.decor.stages)} />
          </View>
        </Animated.View>
        <Text variant="caption" weight={look === 'picked' ? 700 : 600} numberOfLines={1} align="center" compact>
          {word}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
