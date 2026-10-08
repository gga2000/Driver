import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { loadDataSaverPref } from '@/lib/data-saver-pref';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { partnerThemes } from '@driver/design-tokens';
import { CrashBoundary, PhotoImageProvider, ThemeProvider, ToastProvider, useTheme } from '@driver/ui';
import { loadAppearancePref, useAppearance } from '@/lib/appearance';
import { loadTextSize, useTextSize } from '@/lib/text-size';
import { CachedPhoto } from '@/lib/cached-photo';
import { Wordmark } from '@/components/Wordmark';
import { usePushRegistration } from '@/features/notify/Push';
import { useCurrentOffer, useLivePartner, usePartnerGate, useStatus } from '@/features/work/queries';
import { useJobPositions } from '@/features/work/useJobPositions';
import { useBackgroundLocation } from '@/features/work/useBackgroundLocation';
import { keepScreenOn } from '@/features/work/logic';
import { useKeepAwakeWhile } from '@/lib/keep-awake';
import { useJobQueueRunner } from '@/features/work/useJobQueue';
import { ApiProvider } from '@/lib/api';
import { SystemBanner } from '@/components/SystemBanner';
import { crashReporter, startCrashReports } from '@/lib/crash';
import { useAppFonts } from '@/lib/fonts';
import { resolveGuard } from '@/lib/guard';
import { haptics } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { enforceRtl } from '@/lib/rtl';
import { session, useSession } from '@/lib/session';

enforceRtl();
// Crash reports: a no-op until EXPO_PUBLIC_SENTRY_DSN is set (src/lib/crash.ts).
startCrashReports();

/**
 * Driver Partner shell. Route groups:
 *   (auth)/        welcome → phone → otp                      signed-out flow
 *   not-partner    "حسابك مو مفعّل كشريك بعد"                    signed in without a partner role
 *   (tabs)/        الرئيسية (online/offline home) · الأرباح · الحساب
 *   offer          full-screen offer card (pushed by <OfferWatcher> when one arrives)
 *   job            the job in progress: one task, one button
 *   earnings/ scorecard documents/ checkin intercity/ khat/ fleet/ ops/   wave-2 flows (placeholders)
 */
export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  // Night look (n2): the ember palette from sunset to sunrise in Aziziyah, or his fixed choice.
  const { night } = useAppearance();
  const textScale = useTextSize();
  const palette = night ? partnerThemes.ember : partnerThemes.sun;

  useEffect(() => {
    void session.hydrate();
    // Low-data mode (maps program q2): the driver's stored choice.
    void loadDataSaverPref();
    void loadAppearancePref();
    void loadTextSize();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.body.style.backgroundColor = palette.bg;
  }, [palette]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* «الدشبول» (partner redesign): the sun palette (ember after sunset, n2) on the shared components; messages at the top (h11). */}
        <ThemeProvider theme={night ? 'dark' : 'light'} colors={palette} textScale={textScale} fonts={fontsLoaded ? 'plex' : 'system'} haptics={haptics} direction={Platform.OS === 'web' ? 'rtl' : undefined}>
          {/* A render crash anywhere shows «صار خلل» with a retry instead of a white screen. */}
          <CrashBoundary reporter={crashReporter}>
            <ToastProvider bottomOffset={96} placement="top">
              {/* Network photos through expo-image with a memory and disk cache (speed d4). */}
              <PhotoImageProvider component={CachedPhoto}>
                <ApiProvider>
                  <StatusBar style={night ? 'light' : 'dark'} />
                  {/* Launch status banner from the Console (system.banner), above every screen. */}
                  <SystemBanner />
                  <RootNavigator />
                </ApiProvider>
              </PhotoImageProvider>
            </ToastProvider>
          </CrashBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const chrome = useTheme();
  const t = useT();
  const { status } = useSession();
  const gate = usePartnerGate();
  // Push token registration, foreground acks, taps → screens (signed in only).
  usePushRegistration();
  const segments = useSegments();
  const router = useRouter();
  const ready = status === 'signedOut' || (status === 'signedIn' && gate !== 'unknown');

  useEffect(() => {
    const target = resolveGuard({ status, gate, segments });
    if (target) router.replace(target);
  }, [status, gate, segments, router]);

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
        <Stack.Screen name="not-partner" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="offer" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade_from_bottom' }} />
        <Stack.Screen name="job" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="chat/[orderId]" options={{ headerShown: false }} />
        {/* Wave 2 replaces these routes' contents; titles are set by each screen. */}
        <Stack.Screen name="earnings/statement" options={{ title: t('partner.earnings_breakdown') }} />
        <Stack.Screen name="scorecard" options={{ title: t('partner.hub_scorecard') }} />
        <Stack.Screen name="compliments" options={{ title: t('partner.compliments_title') }} />
        <Stack.Screen name="documents/index" options={{ title: t('partner.hub_documents') }} />
        <Stack.Screen name="photo" options={{ title: t('partner.mainphoto_title') }} />
        <Stack.Screen name="vehicle" options={{ title: t('partner.features_title') }} />
        <Stack.Screen name="seen" options={{ title: t('partner.seen_title') }} />
        <Stack.Screen name="location-why" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade_from_bottom' }} />
        <Stack.Screen name="checkin" options={{ title: t('partner.hub_checkin') }} />
        <Stack.Screen name="intercity/index" options={{ title: t('partner.hub_intercity') }} />
        <Stack.Screen name="khat/index" options={{ title: t('partner.hub_khat') }} />
        <Stack.Screen name="fleet/index" options={{ title: t('partner.hub_fleet') }} />
        <Stack.Screen name="ops/index" options={{ title: t('partner.hub_ops') }} />
        <Stack.Screen name="job-topup" options={{ title: t('partner.job_topup_title') }} />
        <Stack.Screen name="shift" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade_from_bottom' }} />
        <Stack.Screen name="earnings/receipt" options={{ title: t('partner.receipt_title') }} />
        <Stack.Screen name="emergency" options={{ title: t('partner.ec_title') }} />
      </Stack>
      {status === 'signedIn' && gate === 'allowed' ? <OfferWatcher /> : null}
      {ready ? null : <Splash />}
    </View>
  );
}

/**
 * Brings the offer card up wherever the driver is (home, or on a job for a batch offer) as soon as
 * `partner.currentOffer` returns one. Each offer is pushed once; the card closes itself.
 */
function OfferWatcher() {
  const status = useStatus();
  const online = status.data?.online ?? false;
  // The driver's live channel: a new offer, job changes, gate and cash arrive as events.
  useLivePartner(Boolean(status.data?.canDrive));
  // Speed audit o3: on a cold start (from an offer push) the offer loads alongside his status, not
  // after it; once the status is in, only while online.
  const offer = useCurrentOffer(status.data ? online : status.isPending);
  // On a job: his fixes feed the customer's map and the kitchen's courier ETA (trips.reportPosition).
  useJobPositions(Boolean(status.data?.activeTripId));
  // Online or on a job with the app in the background: the OS location service keeps both going.
  useBackgroundLocation(status.data);
  // An offer showing or a job: the screen stays on (P-01). Waiting online it may sleep (speed b2); offers ring by push.
  useKeepAwakeWhile(keepScreenOn(status.data, Boolean(offer.data?.offerId)));
  // Job taps saved offline are replayed in order as soon as the network is back (P-09).
  useJobQueueRunner(true);
  const segments = useSegments();
  const router = useRouter();
  const shown = useRef<string | null>(null);
  const offerId = offer.data?.offerId ?? null;

  useEffect(() => {
    if (!offerId || shown.current === offerId || segments[0] === 'offer') return;
    shown.current = offerId;
    router.push('/offer');
  }, [offerId, segments, router]);
  return null;
}

/** Shown while the session and the role gate load (avoids a flash of the wrong stack). */
function Splash() {
  const chrome = useTheme();
  return (
    <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: chrome.colors.bg }}>
      <Wordmark partner />
    </View>
  );
}
