import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { CornerFill, Icon, LocalPhoto, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * A shop on the 3D map in the late-afternoon sun, and the same shop with its lights on at night. The box
 * shows only where the map runs (the website for now), so the pictures live with the website's files in
 * public/ and phones don't carry them; bump the `.v1` when a picture changes.
 */
const PICTURES: Record<'day' | 'night', ImageSourcePropType> = {
  day: { uri: '/pictures/home-map-day.v1.webp' },
  night: { uri: '/pictures/home-map-night.v1.webp' },
};

/** The picture shows the town after dark from 18:00 to 06:00 (Aziziyah's sunset is 17:00–19:30 over the year). */
export const mapBoxNight = (hour: number) => hour >= 18 || hour < 6;

/** The picture starts this much closer and settles back, once, like the map's camera landing. */
const SETTLE_FROM = 1.06;
const SETTLE_MS = 900;

/**
 * «مطاعم العزيزية على الخريطة» (Ali 2026-10-10, look A "window": "a more prominent feature with its own
 * box"): the way into the restaurant map, under the kitchens. A still of a real shop on the 3D map
 * (golden by day, its lights and lantern at night) with the live «8 فاتحين هسة» on it, over a Soft Tint
 * line in the food card's colours and the one saffron arrow at this end of the page. The first time most
 * of it is on screen the picture settles back from a little closer, once (not under reduce motion); it
 * sinks a little under the finger, like «كل المحلات». The picture loads only as the box nears the screen.
 */
export function MapBox({ night, fact, scrollY }: { night: boolean; fact: string; scrollY: SharedValue<number> }) {
  const theme = useTheme();
  const t = useT();
  const card = theme.services.food.card;
  const { height: screenH } = useWindowDimensions();
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.02 * p.value }] }));

  // Settle once: the picture comes in a touch close and eases back when the box is first mostly in view.
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  const zoom = useSharedValue(theme.reduceMotion ? 1 : SETTLE_FROM);
  const settled = useSharedValue(theme.reduceMotion);
  const settle = () => {
    zoom.value = withTiming(1, { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) });
  };
  useAnimatedReaction(
    () => (box == null || settled.value ? false : scrollY.value + screenH > box.y + box.h * 0.7),
    (seen) => {
      if (!seen) return;
      settled.value = true;
      runOnJS(settle)();
    },
    [box, screenH],
  );
  const drift = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));

  return (
    <Animated.View style={sink} onLayout={(e) => setBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
      <Pressable
        testID="home-map-box"
        accessibilityRole="button"
        accessibilityLabel={`${t('home.map_box_title')}، ${fact}`}
        accessibilityHint={t('home.map_box_line')}
        onPress={() => {
          theme.haptic('selection');
          router.push('/restaurant-map');
        }}
        onPressIn={() => {
          if (!theme.reduceMotion) p.value = withSpring(1, theme.motion.spring.press);
        }}
        onPressOut={() => {
          p.value = withSpring(0, theme.motion.spring.select);
        }}
        style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: card.bg, borderWidth: 1, borderColor: withAlpha(card.on, 0.07) }}
      >
        <View style={{ width: '100%', aspectRatio: 16 / 9, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <Animated.View style={[{ width: '100%', height: '100%' }, drift]}>
            <LocalPhoto testID="home-map-box-picture" source={night ? PICTURES.night : PICTURES.day} style={{ width: '100%', height: '100%' }} />
          </Animated.View>
          {/* What the map holds right now: the food tile's live fact, with its dot. */}
          <View
            style={{
              position: 'absolute',
              top: theme.space[3],
              start: theme.space[3],
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              minHeight: 30,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: withAlpha(theme.colors.surface, 0.94),
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: card.dot }} />
            <Text variant="caption" weight={700} color={card.on} tabular>
              {fact}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[4], paddingStart: theme.space[5], paddingEnd: theme.space[4] }}>
          {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" face="display" color={card.on} numberOfLines={2}>
              {t('home.map_box_title')}
            </Text>
            <Text variant="footnote" weight={500} color={card.sub}>
              {t('home.map_box_line')}
            </Text>
          </View>
          <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent }}>
            <Icon name="chevron-forward" size={22} color={theme.colors.onAccent} strokeWidth={2.4} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
