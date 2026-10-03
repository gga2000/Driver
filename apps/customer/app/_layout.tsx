import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, ToastProvider, createTheme } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { HeaderBack } from '@/features/food/HeaderBack';
import { ApiProvider } from '@/lib/api';
import { useAppFonts } from '@/lib/fonts';
import { resolveGuard } from '@/lib/guard';
import { haptics } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { profile, useProfile } from '@/lib/profile';
import { enforceRtl } from '@/lib/rtl';
import { session, useSession } from '@/lib/session';

enforceRtl();

/** Static colours for navigator chrome, which sits outside the React theme context. */
const chrome = createTheme('light');

/**
 * App shell. Route groups:
 *   (auth)/   welcome → phone → otp → setup        signed-out flow (+ post-OTP setup)
 *   (tabs)/   الرئيسية · طلباتي · المحفظة · حسابي     signed-in home
 *   restaurant/[id], cart, checkout, order/[id], rajaa, places/   flows pushed over the tabs
 * Later milestones add their own folders here and register them in <Stack> below.
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { locale } = useProfile();

  useEffect(() => {
    void session.hydrate();
    void profile.load();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = locale === 'en' ? 'en' : 'ar';
    document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
    document.body.style.backgroundColor = chrome.colors.bg;
  }, [locale]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider
          theme="light"
          fonts={fontsLoaded ? 'plex' : 'system'}
          haptics={haptics}
          // Native direction comes from I18nManager (needs a restart to flip); the web flips live.
          direction={Platform.OS === 'web' ? (locale === 'en' ? 'ltr' : 'rtl') : undefined}
        >
          <ToastProvider bottomOffset={96}>
            <ApiProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </ApiProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const t = useT();
  const { status } = useSession();
  const prof = useProfile();
  const segments = useSegments();
  const router = useRouter();
  const ready = status !== 'loading' && prof.loaded;

  useEffect(() => {
    if (!ready) return;
    const target = resolveGuard({ status, setupPending: prof.setupPending, segments });
    if (target) router.replace(target);
  }, [ready, status, prof.setupPending, segments, router]);

  return (
    <View style={{ flex: 1, backgroundColor: chrome.colors.bg }}>
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerBackTitle: t('action.back'),
          headerStyle: { backgroundColor: chrome.colors.bg },
          headerTintColor: chrome.colors.text,
          headerTitleStyle: { fontFamily: Platform.OS === 'web' ? 'IBM Plex Sans Arabic' : 'IBMPlexSansArabic_600SemiBold' },
          contentStyle: { backgroundColor: chrome.colors.bg },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="places" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="restaurant/[id]" options={{ title: '', headerShown: false }} />
        <Stack.Screen name="kitchen/[id]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="cart" options={{ title: t('cart.title'), headerLeft: () => <HeaderBack /> }} />
        <Stack.Screen name="checkout" options={{ title: t('checkout.title'), headerLeft: () => <HeaderBack /> }} />
        <Stack.Screen name="order/[id]" options={{ title: t('order.timeline_title') }} />
        <Stack.Screen name="rajaa" options={{ title: t('home.rajaa_title') }} />
      </Stack>
      {ready ? null : <Splash />}
    </View>
  );
}

/** Shown while the session and profile load from storage (a few ms; avoids a flash of the wrong stack). */
function Splash() {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: chrome.colors.bg,
      }}
    >
      <Wordmark />
    </View>
  );
}
