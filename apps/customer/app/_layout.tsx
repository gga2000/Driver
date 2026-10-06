import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { loadDataSaverPref } from '@/lib/data-saver-pref';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, ToastProvider, createTheme } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { useAccountSync } from '@/features/account/sync';
import { HeaderBack } from '@/features/food/HeaderBack';
import { usePushRegistration } from '@/features/notify/usePush';
import { LockScreenPass, lockScreenPassSupported } from '@/features/rajaa/lockscreen/useLockScreenPass';
import { ApiProvider } from '@/lib/api';
import { SeasonWatcher } from '@/components/SeasonWatcher';
import { SystemBanner } from '@/components/SystemBanner';
import { useAppFonts } from '@/lib/fonts';
import { resolveGuard, returnSpent } from '@/lib/guard';
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
 *   restaurant/[id], cart, checkout, order/[id], rajaa/*, places/   flows pushed over the tabs
 * Later milestones add their own folders here and register them in <Stack> below.
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { locale } = useProfile();

  useEffect(() => {
    void session.hydrate();
    void profile.load();
    // Low-data mode (maps program q2): the customer's stored choice.
    void loadDataSaverPref();
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
              {/* Launch status banner from the Console (system.banner), above every screen. */}
              <SystemBanner />
              {/* Quiet days from the Console (system.season): no celebrations or moment sounds. */}
              <SeasonWatcher />
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
  // Push token registration, foreground acks and taps → screens (signed in only).
  usePushRegistration();
  // Saved places and the vault name → this device; device-only places → the server (once). At the
  // root, not in the tabs: a guest who signs in at "كمّل الطلب" lands on checkout, which needs them.
  useAccountSync();
  const prof = useProfile();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const ready = status !== 'loading' && prof.loaded;

  useEffect(() => {
    if (!ready) return;
    const input = { status, setupPending: prof.setupPending, segments, pathname, welcomed: prof.welcomed, returnTo: prof.returnTo };
    // Back where the guest was going (after OTP and setup): the return path is spent.
    if (returnSpent(input)) void profile.setReturnTo(null);
    const target = resolveGuard(input);
    if (!target) return;
    // A guest stopped at a protected screen comes back to it after sign-in.
    if (target.remember) void profile.setReturnTo(target.remember);
    router.replace(target.to as never);
  }, [ready, status, prof.setupPending, prof.welcomed, prof.returnTo, segments, pathname, router]);

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
        {/* Search and the full restaurant list (audit C-01, C-02): public, like home and menus. */}
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="restaurants" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="household" options={{ headerShown: false }} />
        <Stack.Screen name="topup" options={{ title: t('topup.title'), headerLeft: () => <HeaderBack /> }} />
        <Stack.Screen name="order/[id]" options={{ title: t('order.timeline_title') }} />
        {/* City taxi / tuktuk (spec §5): where to → pin adjust → choose ride → /order/[id]. */}
        <Stack.Screen name="ride/index" options={{ headerShown: false }} />
        <Stack.Screen name="ride/pin" options={{ headerShown: false }} />
        <Stack.Screen name="ride/choose" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[orderId]" options={{ headerShown: false }} />
        <Stack.Screen name="share/[token]" options={{ headerShown: false }} />
        {/* SOS: the emergency contact's live-location page (public, signed token). */}
        <Stack.Screen name="sos/[token]" options={{ headerShown: false }} />
        {/* الرجعة (spec §2): board → seat booking → hold/pay → boarding pass; demand and request boards. */}
        {/* Opened from a push with no history, every الرجعة screen still has a way back (C-26, A-02). */}
        <Stack.Screen name="rajaa/index" options={{ title: t('home.rajaa_title'), headerLeft: () => <HeaderBack /> }} />
        <Stack.Screen name="rajaa/departure/[id]" options={{ title: t('rajaa.book_title'), headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />
        <Stack.Screen name="rajaa/booking/[id]" options={{ title: t('rajaa.book_title'), headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />
        <Stack.Screen name="rajaa/pass/[id]" options={{ title: t('intercity.boarding_pass'), headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />
        <Stack.Screen name="rajaa/demand" options={{ title: t('demand.post_title'), headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />
        <Stack.Screen name="rajaa/request" options={{ title: t('request.title'), headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />
      </Stack>
      {/* الرجعة boarding pass on the lock screen from T−30 (audit d-8; Android). */}
      {lockScreenPassSupported ? <LockScreenPass /> : null}
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
