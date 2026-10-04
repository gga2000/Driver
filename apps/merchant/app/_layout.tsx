import { router, Stack, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, ToastProvider, createTheme } from '@driver/ui';
import { BottomBar, NavRail, NAV_ITEMS, type NavItem } from '@/components/Shell';
import { Wordmark } from '@/components/Wordmark';
import { PrePromptGate, usePushRegistration } from '@/features/notify/Push';
import { ReceiptPreview } from '@/features/print/ReceiptPreview';
import { MerchantRuntime } from '@/features/runtime/MerchantRuntime';
import { useBoard } from '@/features/board/queries';
import { useCurrentStore } from '@/features/store/queries';
import { ApiProvider } from '@/lib/api';
import { useAppFonts } from '@/lib/fonts';
import { isSectionRoot, resolveGuard, sectionOf } from '@/lib/guard';
import { haptics } from '@/lib/haptics';
import { WIDE_MIN_WIDTH } from '@/lib/layout';
import { prefs, usePrefs } from '@/lib/prefs';
import { enforceRtl } from '@/lib/rtl';
import { session, useSession } from '@/lib/session';

enforceRtl();

/** Static colours for navigator chrome, which sits outside the React theme context. */
const chrome = createTheme('light');

/**
 * Driver Merchant shell. Routes:
 *   (auth)/          welcome → phone → otp              signed-out flow
 *   not-activated    friendly gate for a number with no merchant role
 *   stores           store picker (more than one store)
 *   index            الطلبات — the orders board
 *   menu/ money/ insights   wave-2 sections (placeholders until then)
 *   more → deals/ staff/ printer hours settings
 * Navigation: a rail on the start side on tablets/wide web (≥ 900 px), bottom tabs on a phone.
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { locale } = usePrefs();
  const { width } = useWindowDimensions();

  useEffect(() => {
    void session.hydrate();
    void prefs.load();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = locale === 'en' ? 'en' : 'ar';
    document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
    document.body.style.backgroundColor = chrome.colors.bg;
    document.title = locale === 'en' ? 'Driver Merchant' : 'درايفر للمطاعم';
  }, [locale]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="light" fonts={fontsLoaded ? 'plex' : 'system'} haptics={haptics} direction={Platform.OS === 'web' ? (locale === 'en' ? 'ltr' : 'rtl') : undefined}>
          <ToastProvider bottomOffset={width >= WIDE_MIN_WIDTH ? 24 : 96} maxWidth={width >= WIDE_MIN_WIDTH ? 560 : undefined}>
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
  const { status } = useSession();
  // Push token registration, foreground acks, taps → screens (signed in only).
  usePushRegistration();
  const p = usePrefs();
  const segments = useSegments();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_MIN_WIDTH;
  const { access, store, canSeeMoney } = useCurrentStore();
  const signedIn = status === 'signedIn';
  const ready = status !== 'loading' && p.loaded && (!signedIn || access !== 'loading');

  // Remember the store this device works for (auto-picked when there is only one).
  useEffect(() => {
    if (access === 'ready' && store && p.storeId !== store.orgId) void prefs.setStore(store.orgId);
  }, [access, store, p.storeId]);

  useEffect(() => {
    if (!ready) return;
    const target = resolveGuard({ status, access, segments });
    if (target) router.replace(target);
  }, [ready, status, access, segments]);

  const section = sectionOf(segments);
  const showNav = signedIn && access === 'ready' && section !== null;
  const items = NAV_ITEMS.filter((i) => i.section !== 'money' || canSeeMoney);
  const board = useBoard(showNav && store ? store.orgId : null);
  const newCount = board.data?.orders.filter((o) => o.column === 'new').length ?? 0;
  const navigate = (item: NavItem) => {
    if (section === item.section && isSectionRoot(segments)) return;
    router.navigate(item.href as Href);
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: chrome.colors.bg }}>
      {showNav && wide ? <NavRail items={items} active={section} newCount={newCount} onNavigate={navigate} /> : null}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: chrome.colors.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="not-activated" options={{ gestureEnabled: false }} />
          <Stack.Screen name="stores" />
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="menu/index" options={{ animation: 'none' }} />
          <Stack.Screen name="money/index" options={{ animation: 'none' }} />
          <Stack.Screen name="insights" options={{ animation: 'none' }} />
          <Stack.Screen name="more" options={{ animation: 'none' }} />
        </Stack>
        {showNav && !wide && isSectionRoot(segments) ? <BottomBar items={items} active={section} newCount={newCount} onNavigate={navigate} /> : null}
        {signedIn && access === 'ready' && store ? <MerchantRuntime storeId={store.orgId} onBoard={section === 'orders'} bottomBar={!wide && isSectionRoot(segments)} /> : null}
      </View>
      <ReceiptPreview />
      {/* A new order must ring with the app closed: ask on the board, once the store is ready. */}
      <PrePromptGate active={signedIn && access === 'ready' && section === 'orders'} />
      {ready ? null : <Splash />}
    </View>
  );
}

/** While the session, prefs and stores load (a moment; avoids a flash of the wrong screen). */
function Splash() {
  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: chrome.colors.bg }}>
      <Wordmark />
    </View>
  );
}
