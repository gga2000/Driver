import { router } from 'expo-router';
import { useState } from 'react';
import { I18nManager, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { FoodDoor } from '@driver/contracts';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { useDoorFactText } from '@/features/doors/DoorTile';
import { countKey } from '@/lib/plural';
import { useT } from '@/lib/i18n';
import { headlineOf, isNight, STREET_PHOTO_RATIO, tagBox, TAG_SPOTS, type Street } from './landing';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const STREET = require('../../../assets/food-landing/street.webp') as number;

/** Phones mirror absolute `left` in RTL (Yoga swaps it to `start`); the web keeps it physical. */
const SWAPPED = Platform.OS !== 'web' && I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;
function fromLeft(x: number): { left: number } | { right: number } {
  return SWAPPED ? { right: x } : { left: x };
}

/** The hero's height for a column `width`: the street from the signs down to the shop fronts. */
export function heroHeight(width: number, screenHeight: number): number {
  return Math.round(Math.min(width * 1.44, screenHeight * 0.7));
}

const TAG_W = 128;

/**
 * «سوق الليل» (Ali 2026-10-08, direction A): one night photo of an Aziziyah food street, a grill,
 * a juice stand, a sweets shop and a tea stall, each with a tag saying what is open behind it now.
 * A tag is the door: tap the juice stand, you are in «عصير وبارد». After midnight, or with nothing
 * open, the street goes dark, closed shops say when they open, and the lit one glows gold.
 */
export function StreetHero({ street, width, height, top, loading = false }: { street: Street; width: number; height: number; top: number; loading?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const say = useDoorFactText();
  const night = !loading && isNight(street);
  const ink = theme.colors.inverse;
  const photo = { width, height: width * STREET_PHOTO_RATIO, top: top - Math.round(width * 0.11) };
  const head = loading ? headlineOf({ ...street, asleep: false, onlyOpen: null }) : headlineOf(street);
  const [wordsBottom, setWordsBottom] = useState(0);
  const big = width >= 360 ? { fontSize: 36, lineHeight: 46 } : { fontSize: 30, lineHeight: 40 };
  return (
    <View testID="food-street" style={{ width, height, overflow: 'hidden', backgroundColor: ink }}>
      <Image
        source={STREET}
        resizeMode="cover"
        accessibilityRole="image"
        accessibilityLabel={t('food.landing.photo_a11y')}
        style={{ position: 'absolute', top: photo.top, start: 0, width: photo.width, height: photo.height }}
      />
      {/* Shade: dark under the status bar and the words, the shop fronts clear, a little dusk at the foot. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="street-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={night ? 0.8 : 0.72} />
              <Stop offset="0.3" stopColor={ink} stopOpacity={night ? 0.62 : 0.22} />
              <Stop offset="0.52" stopColor={ink} stopOpacity={night ? 0.6 : 0} />
              <Stop offset="1" stopColor={ink} stopOpacity={night ? 0.78 : 0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#street-shade)" />
        </Svg>
      </View>

      <View style={{ position: 'absolute', top: top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
        <Pressable
          testID="header-back"
          accessibilityRole="button"
          accessibilityLabel={t('action.back')}
          hitSlop={4}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(ink, pressed ? 0.7 : 0.5) })}
        >
          <Icon name="arrow-back" size={22} color="onInverse" />
        </Pressable>
        {street.openCount > 0 ? (
          <View
            testID="food-open-count"
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: withAlpha(ink, 0.55) }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.onInverseSuccess }} />
            <Text variant="label" weight={600} color="onInverse" tabular numberOfLines={1}>
              {t(countKey('food.landing.open_now', street.openCount), { n: street.openCount })}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={{ position: 'absolute', top: top + 64, start: theme.space[5], end: theme.space[5] }}
        onLayout={(e) => setWordsBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      >
        <Text testID="food-moment" accessibilityRole="header" weight={700} color="onInverse" maxFontSizeMultiplier={1.25} style={big}>
          {t(head.one)}
          {'\n'}
          <Text weight={700} color="onInverseAccent" maxFontSizeMultiplier={1.25} style={big}>
            {'time' in head ? t(head.two, { time: head.time }) : t(head.two)}
          </Text>
        </Text>
      </View>

      {loading ? null : street.order.map((door) => (
        <ShopTag
          key={door}
          door={door}
          fact={say(street.facts[door])}
          lit={street.facts[door].kind === 'open'}
          night={night}
          box={tagBox(TAG_SPOTS[door], photo, TAG_W)}
          floor={wordsBottom + theme.space[3]}
        />
      ))}
    </View>
  );
}

/** One shop's tag on the photo: its door's name and live line, a small point down to the shop. */
function ShopTag({
  door,
  fact,
  lit,
  night,
  box,
  floor,
}: {
  door: FoodDoor;
  fact: string | null;
  lit: boolean;
  night: boolean;
  box: { left: number; pointY: number };
  /** The headline's foot: a tag never climbs over the words. */
  floor: number;
}) {
  const theme = useTheme();
  const t = useT();
  const ink = theme.colors.inverse;
  const name = t(`food.door.${door}`);
  const glow = night && lit;
  const edge = glow ? theme.colors.onInverseAccent : withAlpha(theme.colors.onInverseAccent, night ? 0.18 : 0.42);
  const bottom = Math.max(box.pointY - 8, floor + 56);
  return (
    <Pressable
      testID={`food-tag-${door}`}
      accessibilityRole="button"
      accessibilityLabel={fact ? t('food.door_a11y', { door: name, fact }) : name}
      hitSlop={6}
      onPress={() => {
        theme.haptic('selection');
        router.push({ pathname: '/food/[door]', params: { door } });
      }}
      style={({ pressed }) => ({
        position: 'absolute',
        ...fromLeft(box.left),
        top: bottom - 56,
        width: TAG_W,
        alignItems: 'center',
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {/* The point: a small square turned on its corner, peeking out under the tag's middle. */}
      <View style={{ position: 'absolute', bottom: -5, width: 12, height: 12, transform: [{ rotate: '45deg' }], backgroundColor: ink, borderWidth: 1, borderColor: edge }} />
      <View
        style={{
          minHeight: 48,
          maxWidth: TAG_W,
          paddingHorizontal: theme.space[3],
          paddingVertical: 6,
          borderRadius: theme.radius.md,
          backgroundColor: ink,
          borderWidth: glow ? 1.5 : 1,
          borderColor: edge,
          alignItems: 'flex-start',
          boxShadow: glow ? `0px 0px 0px 3px ${withAlpha(theme.colors.onInverseAccent, 0.2)}` : undefined,
        }}
      >
        <Text variant="label" weight={700} color="onInverse" numberOfLines={1}>
          {name}
        </Text>
        {fact ? (
          <Text variant="caption" weight={500} color={lit ? 'onInverseAccent' : 'onInverseMuted'} tabular numberOfLines={1}>
            {fact}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
