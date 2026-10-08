import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Button, Icon, MAX_CONTENT_WIDTH, Text, useTheme, withAlpha } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { CITY_ID } from '@/features/food/queries';
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
 * number. The live pill (`catalog.today`) and the honest-delay promise only show when the server
 * answered; offline the screen still reads whole without them.
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
  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: night }}>
      <StatusBar style="light" />
      <Image
        source={STREET}
        resizeMode="cover"
        accessibilityRole="image"
        accessibilityLabel={t('welcome.photo_a11y')}
        style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }}
      />
      {/* Shade: a light veil under the status bar, the street clear in the middle, date brown under the words. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="welcome-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={night} stopOpacity={0.4} />
              <Stop offset="0.16" stopColor={night} stopOpacity={0} />
              <Stop offset="0.42" stopColor={night} stopOpacity={0} />
              <Stop offset="0.64" stopColor={night} stopOpacity={0.74} />
              <Stop offset="0.84" stopColor={night} stopOpacity={1} />
              <Stop offset="1" stopColor={night} stopOpacity={1} />
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

          <View style={{ gap: theme.space[5] }}>
            <View style={{ gap: theme.space[3] }}>
              <Text accessibilityRole="header" weight={700} color="onInverse" maxFontSizeMultiplier={1.3} style={{ fontSize: 40, lineHeight: 50 }}>
                {t('welcome.title_1')}
                {'\n'}
                <Text weight={700} color="onInverseAccent" maxFontSizeMultiplier={1.3} style={{ fontSize: 40, lineHeight: 50 }}>
                  {t('welcome.title_2')}
                </Text>
              </Text>
              <Text color={withAlpha(theme.colors.onInverse, 0.84)} style={{ fontSize: 16, lineHeight: 26 }}>
                {t('welcome.body')}
              </Text>
              {today.data ? (
                <View testID="welcome-promise" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                  <Icon name="shield" size={16} color="onInverseAccent" />
                  <Text variant="footnote" color={withAlpha(theme.colors.onInverse, 0.72)} style={{ flexShrink: 1 }}>
                    {t('promise.line', { minutes: today.data.latePromiseMin })}
                  </Text>
                </View>
              ) : null}
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
