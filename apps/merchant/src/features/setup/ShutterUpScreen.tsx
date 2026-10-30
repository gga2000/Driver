import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AdminMenu, MerchantSetupView } from '@driver/contracts';
import { Button, Icon, Skeleton, Text, useTheme, withAlpha } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { absoluteUrl } from '@/features/menu/photo';
import { useMenu } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { chime } from '@/lib/alert-sound';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { useCounterToast } from '@/lib/toast';
import { doorsOf, SHUTTER_OPEN_AT, voiceOf } from './logic';
import { useSetup, useSetupActions } from './queries';

const GROOVES = 11;

/** A quiet text button on the date-brown screen (the theme's ghost button is saffron ink, for cream). */
function DarkLink({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.space[5], opacity: pressed ? 0.7 : 1 })}>
      <Text variant="bodyStrong" style={{ color: COUNTER.onDate, textDecorationLine: 'underline' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * «ارفع الكبنك» (l1, l2): the last step is his. He drags his own shutter up (or taps the button under
 * it; a phone asking for less motion just jumps), the shop goes live (`merchant.setup.goLive`) and
 * «مبروك» shows his own dishes and «العزيزية تگدر تشوفك هسة». With a step still open, it says which.
 */
export function ShutterUpScreen() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const setup = useSetup(storeId);
  const menu = useMenu(storeId);
  return (
    <SafeAreaView testID="setup-open" style={{ flex: 1, backgroundColor: COUNTER.date }}>
      <Loadable query={setup} stale={false} skeleton={<View style={{ padding: theme.space[5] }}><Skeleton height={420} radius={theme.radius.xl} /></View>} failed={t('merchant.setup.load_failed')} testID="setup-open">
        {(view) => (view.live ? <Congrats view={view} menu={menu.data} /> : view.progress.left > 0 ? <NotYet view={view} /> : <Raise view={view} menu={menu.data} />)}
      </Loadable>
    </SafeAreaView>
  );
}

function photosOf(menu: AdminMenu | undefined): string[] {
  return (menu?.categories ?? []).flatMap((c) => c.items).flatMap((i) => (i.photoUrl ? [absoluteUrl(i.photoUrl)] : [])).slice(0, 4);
}

function NotYet({ view }: { view: MerchantSetupView }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: theme.space[6], gap: theme.space[4] }}>
      <Text style={[theme.face('display'), { color: COUNTER.onDate, fontSize: 26, lineHeight: 40 }]}>{t('merchant.setup.not_yet_title')}</Text>
      <Text variant="body" style={{ color: COUNTER.onDateMuted }}>
        {view.progress.left === 1 ? t('merchant.setup.not_yet_one') : t('merchant.setup.not_yet', { count: view.progress.left })}
      </Text>
      <Button testID="setup-open-back" label={t('merchant.setup.back_to_list')} size="lg" onPress={() => router.replace('/setup')} />
    </View>
  );
}

function Raise({ view, menu }: { view: MerchantSetupView; menu: AdminMenu | undefined }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const { goLive } = useSetupActions();
  const height = wide ? 380 : 300;
  const up = useSharedValue(0);
  const start = useSharedValue(0);
  const busy = useSharedValue(false);

  const open = async () => {
    theme.haptic('heavy');
    chime(0.6);
    try {
      await goLive.mutateAsync({ merchantOrgId: view.merchantOrgId });
      theme.haptic('success');
    } catch (err) {
      busy.value = false;
      up.value = theme.reduceMotion ? 0 : withSpring(0, { damping: 16 });
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  const tapOpen = () => {
    if (busy.value) return;
    busy.value = true;
    up.value = theme.reduceMotion ? 1 : withTiming(1, { duration: 900, easing: Easing.bezier(0.33, 0, 0.2, 1) });
    void open();
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => {
      start.value = up.value;
    })
    .onUpdate((e) => {
      if (busy.value) return;
      up.value = Math.min(1, Math.max(0, start.value - e.translationY / height));
    })
    .onEnd((e) => {
      if (busy.value) return;
      if (up.value >= SHUTTER_OPEN_AT || (up.value >= 0.35 && e.velocityY < -600)) {
        busy.value = true;
        up.value = withTiming(1, { duration: 360 });
        runOnJS(open)();
      } else {
        up.value = withSpring(0, { damping: 16 });
      }
    });

  const shutter = useAnimatedStyle(() => ({ transform: [{ translateY: -up.value * height }] }));
  const photos = photosOf(menu);
  const voice = voiceOf(doorsOf(view));

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', padding: theme.space[5], gap: theme.space[4], justifyContent: 'center' }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="label" weight={600} style={{ color: COUNTER.onDateMuted }}>
          {t('merchant.setup.last_step')}
        </Text>
        <Text accessibilityRole="header" style={[theme.face('display'), { color: COUNTER.onDate, fontSize: wide ? 34 : 28, lineHeight: wide ? 50 : 42 }]}>
          {t('merchant.setup.raise_title')}
        </Text>
      </View>
      <GestureDetector gesture={pan}>
        <View testID="setup-shutter" accessibilityRole="button" accessibilityLabel={t('merchant.setup.raise_cta')} accessibilityHint={t('merchant.setup.raise_hint')} style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: COUNTER.glow }}>
          {/* Behind the shutter: his own dishes on the counter, lit. */}
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View style={{ position: 'absolute', top: 24, alignSelf: 'center', width: 2, height: 28, backgroundColor: COUNTER.shutterBox }} />
            <View style={{ position: 'absolute', top: 50, alignSelf: 'center', width: 52, height: 24, borderTopStartRadius: 26, borderTopEndRadius: 26, backgroundColor: COUNTER.newBadge }} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[2] }}>
              {(photos.length ? photos : [null, null, null]).map((p, i) => (
                <View key={i} style={{ width: wide ? 110 : 76, height: wide ? 84 : 60, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: i % 2 ? COUNTER.saffron : COUNTER.ready, borderWidth: 3, borderColor: COUNTER.paper }}>
                  {p ? <Image source={{ uri: p }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}
                </View>
              ))}
            </View>
            <View style={{ height: 46, backgroundColor: COUNTER.dateRaised, borderTopWidth: 5, borderTopColor: COUNTER.newBadge }} />
          </View>
          <Animated.View style={[{ position: 'absolute', top: 0, start: 0, end: 0, height: '100%', backgroundColor: COUNTER.shutter }, shutter]}>
            {Array.from({ length: GROOVES }, (_, i) => (
              <View key={i} style={{ flex: 1, borderBottomWidth: 3, borderBottomColor: COUNTER.shutterGroove, borderTopWidth: 1, borderTopColor: withAlpha('#FFFFFF', 0.28) }} />
            ))}
            <View style={{ position: 'absolute', bottom: 18, alignSelf: 'center', alignItems: 'center', gap: theme.space[2] }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: COUNTER.saffron, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: COUNTER.paper }}>
                <Icon name="chevron-down" size={32} color={COUNTER.date} strokeWidth={2.8} style={{ transform: [{ rotate: '180deg' }] }} />
              </View>
              <View style={{ width: 84, height: 10, borderRadius: 5, backgroundColor: COUNTER.shutterBox }} />
            </View>
          </Animated.View>
          <View style={{ position: 'absolute', top: 0, start: 0, end: 0, height: 16, backgroundColor: COUNTER.shutterBox }} />
        </View>
      </GestureDetector>
      <Text variant="body" align="center" style={{ color: COUNTER.onDateMuted }}>
        {t(voice === 'drinks' ? 'merchant.setup.raise_hint_drinks' : 'merchant.setup.raise_hint')}
      </Text>
      <Button testID="setup-raise" label={t('merchant.setup.raise_cta')} size="lg" fullWidth loading={goLive.isPending} onPress={tapOpen} />
      <DarkLink testID="setup-open-later" label={t('merchant.setup.later')} onPress={() => router.replace('/')} />
    </ScrollView>
  );
}

/** l2: «مبروك» with his own dishes behind the open shutter. */
function Congrats({ view, menu }: { view: MerchantSetupView; menu: AdminMenu | undefined }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const photos = photosOf(menu);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center', padding: theme.space[5], gap: theme.space[5], justifyContent: 'center' }}>
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(400)} testID="setup-congrats" style={{ gap: theme.space[4] }}>
        <View style={{ alignSelf: 'center', width: 88, height: 88, borderRadius: 44, backgroundColor: COUNTER.ready, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: COUNTER.onDateReady }}>
          <MIcon name="check" size={44} color={COUNTER.onDate} strokeWidth={2.8} />
        </View>
        <Text accessibilityRole="header" align="center" style={[theme.face('display'), { color: COUNTER.onDate, fontSize: wide ? 44 : 36, lineHeight: wide ? 64 : 54 }]}>
          {t('merchant.setup.congrats')}
        </Text>
        <Text variant="body" align="center" style={{ color: COUNTER.onDateMuted, fontSize: 18, lineHeight: 30 }}>
          {t('merchant.setup.congrats_body', { shop: view.name })}
        </Text>
        {photos.length > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <View key={p} style={{ width: wide ? 120 : 72, aspectRatio: 1, borderRadius: theme.radius.lg, overflow: 'hidden', borderWidth: 3, borderColor: COUNTER.glow }}>
                <Image source={{ uri: p }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: COUNTER.dateRaised }}>
          <MIcon name="bell" size={20} color={COUNTER.busy} />
          <Text variant="footnote" weight={600} style={{ flex: 1, color: COUNTER.onDate }}>
            {t('merchant.setup.congrats_note')}
          </Text>
        </View>
        <Button testID="setup-to-board" label={t('merchant.setup.to_board')} size="lg" fullWidth onPress={() => router.replace('/')} />
        <DarkLink testID="setup-see-shop" label={t('merchant.setup.see_shop')} onPress={() => router.replace('/more')} />
      </Animated.View>
    </ScrollView>
  );
}
