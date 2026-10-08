import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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

/**
 * First launch, "Golden street" (Ali 2026-10-08, direction A): one cinematic photo of an Aziziyah
 * market street at golden hour (samoon oven, Corolla taxi, plum tuktuk, delivery bike) under a
 * date-brown fade, the line «العزيزية كلها بدوسة وحدة», and the same two ways in: "يلا نبدي" opens
 * home as a guest (menus and prices before any phone number, C-18), "عندك حساب؟" goes to the
 * number. The live pill (`catalog.today`) only shows when the server answered; offline the screen
 * still reads whole without it. On a short phone the photo slides up so the street clears the words
 * (`streetLift`), and the shade starts where the words do. The honest-delay promise is told at checkout,
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
  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: night }}>
      <StatusBar style="light" />
      <Image
        source={STREET}
        resizeMode="cover"
        accessibilityRole="image"
        accessibilityLabel={t('welcome.photo_a11y')}
        style={{ position: 'absolute', top: -lift, start: 0, width: '100%', height: height + lift }}
      />
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
            <View style={{ gap: theme.space[3] }}>
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
            </View>

            <View style={{ gap: theme.space[1] }}>
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
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
