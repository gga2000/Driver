import { router, Stack, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, Platform, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CrashBoundary, getNetwork, ModalSheetDefaultsProvider, RetryState, ThemeProvider, ToastProvider, createTheme, useLoadTimeout, useNetwork } from '@driver/ui';
import { BottomBar, NavRail, NAV_ITEMS, type NavItem } from '@/components/Shell';
import { Wordmark } from '@/components/Wordmark';
import { usePushRegistration } from '@/features/notify/Push';
import { ReceiptPreview } from '@/features/print/ReceiptPreview';
import { MerchantRuntime } from '@/features/runtime/MerchantRuntime';
import { newCount as countNew } from '@/features/board/logic';
import { useBoard } from '@/features/board/queries';
import { useCurrentStore } from '@/features/store/queries';
import { UpdateRequired } from '@/features/update/UpdateRequired';
import { ApiProvider } from '@/lib/api';
import { isUpdateRequired, subscribeUpdateRequired } from '@/lib/app-version';
import { SystemBanner } from '@/components/SystemBanner';
import { SUPPORT_PHONE } from '@/lib/env';
import { crashReporter, startCrashReports } from '@/lib/crash';
import { useAppFonts } from '@/lib/fonts';
import { useLocale, useT } from '@/lib/i18n';
import { isSectionRoot, resolveGuard, sectionOf } from '@/lib/guard';
import { haptics } from '@/lib/haptics';
import { useToastTop } from '@/lib/toast';
import { WIDE_MIN_WIDTH } from '@/lib/layout';
import { prefs, usePrefs } from '@/lib/prefs';
import { enforceRtl } from '@/lib/rtl';
import { session, useSession } from '@/lib/session';

enforceRtl();
// Crash reports: a no-op until EXPO_PUBLIC_SENTRY_DSN is set (src/lib/crash.ts).
startCrashReports();

/** Static colours for navigator chrome, which sits outside the React theme context. */
const chrome = createTheme('light');

/**
 * Driver Merchant shell. Routes:
 *   (auth)/          welcome → phone → otp              signed-out flow
 *   not-activated    friendly gate for a number with no merchant role
 *   stores           store picker (more than one store)
 *   index            الطلبات — the orders board
 *   menu/ money/ insights   wave-2 sections (placeholders until then)
 *   more → deals/ staff/ printer hours pickup-spot delivery-area menu-photos story settings; menu → pot
 * Navigation: a rail on the start side on tablets/wide web (≥ 900 px), bottom tabs on a phone.
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const { locale } = usePrefs();
  const { width } = useWindowDimensions();
  // CORE-05: the server refused this build; nothing else mounts (no queries, no live stream) until a restart.
  const updateRequired = useSyncExternalStore(subscribeUpdateRequired, isUpdateRequired, isUpdateRequired);

  useEffect(() => {
    void session.hydrate();
    void prefs.load();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = locale === 'en' ? 'en' : 'ar';
    document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
    document.body.style.backgroundColor = chrome.colors.bg;
    document.title = locale === 'en' ? 'Driver Merchant' : 'درايفر للمحلات';
  }, [locale]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="light" fonts={fontsLoaded ? 'brand' : 'system'} haptics={haptics} direction={Platform.OS === 'web' ? (locale === 'en' ? 'ltr' : 'rtl') : undefined}>
          {/* A render crash anywhere shows «صار خلل» with a retry instead of a frozen tablet. */}
          <CrashScreenBoundary locale={locale}>
            {updateRequired ? (
              <>
                <StatusBar style="dark" />
                <UpdateRequired />
              </>
            ) : (
              <CounterToasts bottomOffset={width >= WIDE_MIN_WIDTH ? 24 : 96} maxWidth={width >= WIDE_MIN_WIDTH ? 560 : undefined}>
                <ApiProvider>
                  <StatusBar style="dark" />
                  {/* Launch status banner from the Console (system.banner), above every screen. */}
                  <SheetDefaults>
                    <SystemBanner />
                    <RootNavigator />
                  </SheetDefaults>
                </ApiProvider>
              </CounterToasts>
            )}
          </CrashScreenBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** The root error boundary with the merchant app's own copy (apps/merchant/locales). */
function CrashScreenBoundary({ locale, children }: { locale: ReturnType<typeof useLocale>; children: ReactNode }) {
  const t = useT();
  return (
    <CrashBoundary reporter={crashReporter} locale={locale} title={t('merchant.crash.title')} body={t('merchant.crash.body')} retryLabel={t('merchant.crash.retry')}>
      {children}
    </CrashBoundary>
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
  const { access, store } = useCurrentStore();
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
  // Everyone gets the four tabs: staff see «يومك» without money (counter step 5).
  const items = NAV_ITEMS;
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
        {/* Between the screens and the tab bar: on a phone its "طلبات تنتظر" strip takes its own room. */}
        {signedIn && access === 'ready' && store ? <MerchantRuntime storeId={store.orgId} onBoard={section === 'orders'} bottomBar={showNav && !wide && isSectionRoot(segments)} /> : null}
        {showNav && !wide && isSectionRoot(segments) ? <BottomBar items={items} active={section} newCount={newCount} onNavigate={navigate} /> : null}
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

/** The toast host, opening top toasts under the counter's status bar wherever it is showing. */
function CounterToasts({ children, bottomOffset, maxWidth }: { children: ReactNode; bottomOffset: number; maxWidth: number | undefined }) {
  const topOffset = useToastTop();
  return (
    <ToastProvider bottomOffset={bottomOffset} {...(topOffset !== undefined ? { topOffset } : {})} maxWidth={maxWidth}>
      {children}
    </ToastProvider>
  );
}
