import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { lift, type ServiceSwatch } from '@driver/design-tokens';
import { Icon, Text, useNetwork, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { SERVICES, type ServiceId } from './ServicesRow';

/** The bar's services and their share of its width: «بغداد والكوت» gets the room its two words need. */
const PILLS: ReadonlyArray<{ id: ServiceId; flex: number }> = [
  { id: 'food', flex: 1 },
  { id: 'taxi', flex: 1 },
  { id: 'tuktuk', flex: 1 },
  { id: 'trips', flex: 1.75 },
  { id: 'rajaa', flex: 1.25 },
];
const SEARCH_H = 40;
const PILL_H = 32;

/**
 * Home's header folded into a slim bar (Ali's Yes, effects menu "collapse", 2026-10-07): once the
 * search has scrolled under the top, a cream bar slides down with a short search pill and the five
 * services as small colour buttons, so search and a taxi are always one tap away. It answers like
 * the tiles (offline the ride buttons go grey; with every kitchen closed أكل goes quiet) and is out
 * of the way of touches and screen readers while hidden.
 */
export function CollapsedBar({
  scrollY,
  showAt,
  onService,
  foodOff,
}: {
  scrollY: SharedValue<number>;
  showAt: number;
  onService: (id: ServiceId) => void;
  foodOff: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const online = useNetwork().online;
  const s = theme.services;
  const [shown, setShown] = useState(false);
  const p = useSharedValue(0);
  const reduce = theme.reduceMotion;
  const enter = theme.motion.duration.base;
  const leave = theme.motion.duration.fast;
  useAnimatedReaction(
    () => showAt > 0 && scrollY.value > showAt,
    (on, was) => {
      if (on === was) return;
      p.value = reduce ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: on ? enter : leave });
      runOnJS(setShown)(on);
    },
    [showAt, reduce, enter, leave],
  );
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (p.value - 1) * 14 }],
  }));
  const swatch = (id: ServiceId): ServiceSwatch => {
    if (id === 'food') return foodOff ? s.off : s.food;
    if (!online) return s.off;
    return id === 'taxi' ? s.taxi : id === 'tuktuk' ? s.tuktuk : id === 'trips' ? s.trips : s.back;
  };
  return (
    <Animated.View
      testID="home-bar"
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!shown}
      style={[
        {
          position: 'absolute',
          top: 0,
          start: 0,
          end: 0,
          gap: theme.space[2],
          paddingHorizontal: theme.space[5],
          paddingTop: theme.space[2],
          paddingBottom: theme.space[3],
          backgroundColor: theme.colors.bg,
          borderBottomStartRadius: theme.radius.xl,
          borderBottomEndRadius: theme.radius.xl,
          boxShadow: theme.scheme === 'light' ? lift.card : undefined,
        },
        style,
      ]}
    >
      <Pressable
        testID="home-bar-search"
        accessibilityRole="button"
        accessibilityLabel={t('search.a11y_open')}
        hitSlop={(theme.hitTarget - SEARCH_H) / 2}
        onPress={() => {
          theme.haptic('selection');
          router.push('/search');
        }}
        style={({ pressed }) => ({
          height: SEARCH_H,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surface,
          boxShadow: theme.scheme === 'light' ? lift.card : undefined,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="search" size={18} color="textMuted" />
        <Text variant="footnote" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
          {t('search.placeholder')}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {PILLS.map(({ id, flex }) => {
          const sw = swatch(id);
          const off = sw === s.off && id !== 'food';
          const label = t(SERVICES.find((x) => x.id === id)!.label);
          return (
            <Pressable
              key={id}
              testID={`home-bar-${id}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: off }}
              disabled={off}
              hitSlop={{
                top: (theme.hitTarget - PILL_H) / 2,
                bottom: (theme.hitTarget - PILL_H) / 2,
              }}
              onPress={() => {
                theme.haptic('selection');
                onService(id);
              }}
              style={({ pressed }) => ({
                flex,
                height: PILL_H,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
                borderRadius: theme.radius.md,
                backgroundColor: sw.fill,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <Text
                variant="caption"
                face="display"
                weight={700}
                color={sw.on}
                numberOfLines={1}
                compact
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}
