import { router, Stack, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Linking, Platform, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getNetwork, ModalSheetDefaultsProvider, RetryState, ThemeProvider, ToastProvider, createTheme, useLoadTimeout, useNetwork } from '@driver/ui';
import { BottomBar, NavRail, NAV_ITEMS, type NavItem } from '@/components/Shell';
import { Wordmark } from '@/components/Wordmark';
import { usePushRegistration } from '@/features/notify/Push';
import { ReceiptPreview } from '@/features/print/ReceiptPreview';
import { MerchantRuntime } from '@/features/runtime/MerchantRuntime';
import { newCount as countNew } from '@/features/board/logic';
import { useBoard } from '@/features/board/queries';
import { useCurrentStore } from '@/features/store/queries';
import { ApiProvider } from '@/lib/api';
import { SystemBanner } from '@/components/SystemBanner';
import { SUPPORT_PHONE } from '@/lib/env';
import { useAppFonts } from '@/lib/fonts';
import { useLocale, useT } from '@/lib/i18n';
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
              {/* Launch status banner from the Console (system.banner), above every screen. */}
              <SheetDefaults>
                <SystemBanner />
                <RootNavigator />
              </SheetDefaults>
            </ApiProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Every kitchen sheet closes with "سكّر" and is a bottom sheet on a phone, a dialog on the tablet. */
function SheetDefaults({ children }: { children: ReactNode }) {
  const t = useT();
  const value = useMemo(() => ({ closeLabel: t('merchant.common.close'), layout: 'auto' as const }), [t]);
  return <ModalSheetDefaultsProvider value={value}>{children}</ModalSheetDefaultsProvider>;
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
  // M-10: the same number as the جديد column and the banner.
  const newCount = countNew(board.data?.orders ?? []);
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
      {ready ? null : <Splash />}
      <StartupGate loading={!ready} />
    </View>
  );
}

/**
 * The splash never waits forever (M-08): if the session, prefs and stores haven't loaded after 8 s
 * (API down, no network on a cold start), a full-screen state says so with a retry and the support
 * line instead of a logo that looks like a frozen tablet.
 */
function StartupGate({ loading }: { loading: boolean }) {
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const qc = useQueryClient();
  const [slow, restart] = useLoadTimeout(loading);
  if (!slow) return null;
  return (
    <View testID="startup-error" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: chrome.colors.bg }}>
      <Wordmark />
      <RetryState
        kind={net.state === 'offline' ? 'offline' : 'unreachable'}
        locale={locale}
        title={net.state === 'offline' ? t('merchant.startup.offline_title') : t('merchant.startup.title')}
        body={t('merchant.startup.body')}
        retryLabel={t('merchant.startup.retry')}
        onRetry={() => {
          restart();
          getNetwork().retryNow();
          void qc.refetchQueries({ type: 'active' });
        }}
        secondary={{ label: t('merchant.startup.call_support'), icon: 'phone', onPress: () => void Linking.openURL(`tel:${SUPPORT_PHONE}`) }}
        style={{ maxWidth: 480 }}
      />
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
