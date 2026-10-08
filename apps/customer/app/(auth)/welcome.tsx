import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Button, MAX_CONTENT_WIDTH, Text, useTheme, withAlpha } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { CITY_ID } from '@/features/food/queries';
import { shadeStops, streetLift } from '@/features/welcome/street';
import { nowLine } from '@/features/welcome/today';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const STREET = require('../../assets/welcome/golden-street.webp') as number;

/** The street settles: a slow push back from 6 % closer, once, then still (motion rule: plays once, ~20 s max). */
const DRIFT_MS = 14_000;
const DRIFT_SCALE = 1.06;

/**
 * First launch, "Golden street" (Ali 2026-10-08, direction A): one cinematic photo of an Aziziyah
 * market street at golden hour (samoon oven, Corolla taxi, plum tuktuk, delivery bike) under a
 * date-brown fade, the line «العزيزية كلها بدوسة وحدة», and the same two ways in: "يلا نبدي" opens
 * home as a guest (menus and prices before any phone number, C-18), "عندك حساب؟" goes to the
 * number. The live pill (`catalog.today`) only shows when the server answered; offline the screen
 * still reads whole without it. On a short phone the photo slides up so the street clears the words
 * (`streetLift`), and the shade starts where the words do. On arrival the street drifts back once and
 * comes to rest, the headline and then the buttons rise in; reduce-motion shows everything at rest. The honest-delay promise is told at checkout,
 * where it applies, not here (one message per first screen).
 */
export default function Welcome() {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const today = useQuery({ ...api.catalog.today.queryOptions({ cityId: CITY_ID }), staleTime: 60_000, retry: false });
  const now = nowLine(today.data, t);
  const browse = async () => {
    await profile.setWelcomed();
    router.replace('/');
  };
  const signIn = async () => {
    await profile.setWelcomed();
    await profile.setReturnTo(null);
    router.push('/phone');
  };
  const night = theme.colors.inverse;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [wordsTop, setWordsTop] = useState(0);
  const lift = streetLift(width, height, wordsTop);
  const short = height < 700;
  const title = short ? { fontSize: 34, lineHeight: 44 } : { fontSize: 40, lineHeight: 50 };
  const { drift, wordsIn, buttonsIn } = useArrival();
  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: night }}>
      <StatusBar style="light" />
      <Animated.View style={[{ position: 'absolute', top: -lift, start: 0, width: '100%', height: height + lift }, drift]}>
        <Image source={STREET} resizeMode="cover" accessibilityRole="image" accessibilityLabel={t('welcome.photo_a11y')} style={{ width: '100%', height: '100%' }} />
      </Animated.View>
      {/* Shade: a light veil under the status bar, the street clear in the middle, date brown under the words. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="welcome-shade" x1="0" y1="0" x2="0" y2="1">
              {shadeStops(height, wordsTop).map(([offset, opacity], i) => (
                <Stop key={i} offset={offset} stopColor={night} stopOpacity={opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#welcome-shade)" />
        </Svg>
      </View>

      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView
          role="main"
          bounces={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            alignSelf: 'center',
            paddingHorizontal: theme.space[5],
            paddingTop: theme.space[2],
            paddingBottom: theme.space[3],
            gap: theme.space[8],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
            <Wordmark size="md" onDark />
            {now ? (
              <View
                testID="welcome-proof"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[2],
                  paddingHorizontal: theme.space[3],
                  paddingVertical: 6,
                  borderRadius: theme.radius.pill,
                  backgroundColor: withAlpha(night, 0.5),
                  flexShrink: 1,
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.onInverseSuccess }} />
                <Text variant="label" weight={600} color="onInverse" tabular numberOfLines={1} style={{ flexShrink: 1 }}>
                  {now}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ gap: theme.space[5] }} onLayout={(e) => setWordsTop(insets.top + e.nativeEvent.layout.y)}>
            <Animated.View style={[{ gap: theme.space[3] }, wordsIn]}>
              <Text accessibilityRole="header" weight={700} color="onInverse" maxFontSizeMultiplier={1.3} style={title}>
                {t('welcome.title_1')}
                {'\n'}
                <Text weight={700} color="onInverseAccent" maxFontSizeMultiplier={1.3} style={title}>
                  {t('welcome.title_2')}
                </Text>
              </Text>
              <Text color={withAlpha(theme.colors.onInverse, 0.84)} style={{ fontSize: 16, lineHeight: 26 }}>
                {t('welcome.body')}
              </Text>
            </Animated.View>

            <Animated.View style={[{ gap: theme.space[1] }, buttonsIn]}>
              <Button testID="welcome-start" label={t('onboarding.start')} size="lg" fullWidth haptic="medium" onPress={() => void browse()} />
              <Pressable
                testID="welcome-signin"
                accessibilityRole="button"
                onPress={() => void signIn()}
                hitSlop={8}
                style={({ pressed }) => ({ minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
              >
                <Text variant="button" weight={600} color="onInverseAccent">
                  {t('onboarding.have_account')}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * The arrival, played once on mount: the street drifts back to rest over 14 s (transform only), the
 * headline rises 12 px and fades in, the buttons follow a beat later. Under reduce-motion every value
 * starts at rest, so nothing moves.
 */
function useArrival() {
  const theme = useTheme();
  const still = theme.reduceMotion;
  const street = useSharedValue(still ? 1 : 0);
  const words = useSharedValue(still ? 1 : 0);
  const buttons = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    const [x1, y1, x2, y2] = theme.motion.bezier.decelerate;
    const settle = Easing.bezier(x1, y1, x2, y2);
    const rise = theme.motion.duration.deliberate;
    street.value = withTiming(1, { duration: DRIFT_MS, easing: Easing.out(Easing.cubic) });
    words.value = withDelay(theme.motion.duration.fast, withTiming(1, { duration: rise, easing: settle }));
    buttons.value = withDelay(theme.motion.duration.fast + theme.motion.duration.base, withTiming(1, { duration: rise, easing: settle }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const enter = theme.motion.distance.enter;
  const drift = useAnimatedStyle(() => ({ transform: [{ scale: DRIFT_SCALE - (DRIFT_SCALE - 1) * street.value }] }));
  const wordsIn = useAnimatedStyle(() => ({ opacity: words.value, transform: [{ translateY: (1 - words.value) * enter }] }));
  const buttonsIn = useAnimatedStyle(() => ({ opacity: buttons.value, transform: [{ translateY: (1 - buttons.value) * enter }] }));
  return { drift, wordsIn, buttonsIn };
}
