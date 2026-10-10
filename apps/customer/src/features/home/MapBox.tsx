import { router } from 'expo-router';
import { Pressable, View, type ImageSourcePropType } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon, LocalPhoto, Text, useTheme, withAlpha } from '@driver/ui';
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

/**
 * «مطاعم العزيزية على الخريطة» (Ali 2026-10-10, look A "window": "a more prominent feature with its own
 * box"): the way into the restaurant map, under the kitchens. A still of a real shop on the 3D map
 * (golden by day, its lights and lantern at night) over a cream line with the round ink arrow of
 * «كل المحلات». It sinks a little under the finger, like the boxes above. The picture loads only as the
 * box nears the screen.
 */
export function MapBox({ night }: { night: boolean }) {
  const theme = useTheme();
  const t = useT();
  const card = theme.services.food.card;
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.02 * p.value }] }));
  return (
    <Animated.View style={sink}>
      <Pressable
        testID="home-map-box"
        accessibilityRole="button"
        accessibilityLabel={t('home.map_box_title')}
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
        style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: withAlpha(card.on, 0.08) }}
      >
        <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.colors.surfaceSunken }}>
          <LocalPhoto testID="home-map-box-picture" source={night ? PICTURES.night : PICTURES.day} style={{ width: '100%', height: '100%' }} />
          <View
            style={{
              position: 'absolute',
              top: theme.space[3],
              start: theme.space[3],
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: 30,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: withAlpha(theme.colors.surface, 0.94),
            }}
          >
            <Icon name="map-pin" size={15} color={card.dot} strokeWidth={2.4} />
            <Text variant="caption" weight={700} color={card.on}>
              {t('restaurant_map.open_map')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], paddingStart: theme.space[4], paddingEnd: theme.space[3] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title" face="display" color={card.on} numberOfLines={2}>
              {t('home.map_box_title')}
            </Text>
            <Text variant="footnote" weight={500} color={card.sub}>
              {t('home.map_box_line')}
            </Text>
          </View>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: card.on }}>
            <Icon name="chevron-forward" size={20} color={theme.colors.surface} strokeWidth={2.25} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
