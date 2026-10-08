import { router } from 'expo-router';
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { FoodDoor } from '@driver/contracts';
import { Icon, Text, useMotionPresets, useTheme, withAlpha } from '@driver/ui';
import { DOOR_PHOTOS } from '@/features/food-landing/photos';
import { useT } from '@/lib/i18n';

/** How tall the photo stands: most of a phone's first screen, never all of it. */
export function doorHeroHeight(width: number, screenH: number): number {
  return Math.round(Math.min(width * 0.98, screenH * 0.46));
}

/**
 * The top of a food door (Ali 2026-10-08, concept A «واجهة المحل»): the door's own photo, the same one
 * its tile on /food shows, under a date-brown shade, with the door's name, what it serves and its live
 * fact. It settles in once (1.04 to still) and then holds (speed rule h1).
 */
export function DoorHero({
  door,
  fact,
  open,
  height,
  top,
}: {
  door: FoodDoor;
  fact: string | null;
  open: boolean;
  height: number;
  top: number;
}) {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const ink = theme.colors.inverse;
  const zoom = useSharedValue(presets.reduceMotion ? 1 : 1.04);
  useEffect(() => {
    if (!presets.reduceMotion)
      zoom.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
  }, [presets.reduceMotion, zoom]);
  const settle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const name = t(`food.door.${door}`);
  return (
    <View testID="door-hero" style={{ height, overflow: 'hidden', backgroundColor: ink }}>
      <Animated.View style={[StyleSheet.absoluteFill, settle]}>
        <Image
          source={DOOR_PHOTOS[door]}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`door-hero-${door}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={0.62} />
              <Stop offset="0.3" stopColor={ink} stopOpacity={0.08} />
              <Stop offset="0.5" stopColor={ink} stopOpacity={0.14} />
              <Stop offset="1" stopColor={ink} stopOpacity={0.94} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#door-hero-${door})`} />
        </Svg>
      </View>

      <Pressable
        testID="header-back"
        accessibilityRole="button"
        accessibilityLabel={t('action.back')}
        hitSlop={4}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/food'))}
        style={({ pressed }) => ({
          position: 'absolute',
          top: top + theme.space[2],
          start: theme.space[4],
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(ink, pressed ? 0.7 : 0.5),
        })}
      >
        <Icon name="arrow-back" size={22} color="onInverse" />
      </Pressable>

      <Animated.View
        entering={presets.panelIn(80)}
        style={{
          position: 'absolute',
          start: theme.space[5],
          end: theme.space[5],
          bottom: theme.space[8] + theme.space[2],
          gap: 2,
        }}
      >
        <Text
          weight={700}
          color="onInverse"
          accessibilityRole="header"
          numberOfLines={2}
          maxFontSizeMultiplier={1.25}
          style={{ fontSize: 38, lineHeight: 50 }}
        >
          {name}
        </Text>
        <Text
          variant="body"
          weight={500}
          color={withAlpha(theme.colors.onInverse, 0.86)}
          numberOfLines={2}
        >
          {t(`food.door_hint.${door}`)}
        </Text>
        {fact ? (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              marginTop: theme.space[2],
              paddingHorizontal: theme.space[3],
              paddingVertical: 6,
              borderRadius: theme.radius.pill,
              backgroundColor: withAlpha(ink, 0.6),
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: open ? theme.colors.onInverseSuccess : theme.colors.onInverseMuted,
              }}
            />
            <Text
              variant="label"
              weight={600}
              color={open ? 'onInverse' : 'onInverseMuted'}
              tabular
              numberOfLines={1}
              testID="door-fact"
            >
              {fact}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
