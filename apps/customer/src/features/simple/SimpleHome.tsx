import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { Order } from '@driver/contracts';
import { Button, Icon, Text, useTheme, useToast, withAlpha, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useMe, useSavePlace } from '@/features/account/queries';
import { defaultPlaceName, EMPTY_PLACE_EDITOR, toSaveInput } from '@/features/account/PlaceEditor';
import { liveStatusKey } from '@/features/home/live-card';
import { useRideSpots } from '@/features/ride/useSpots';
import { rideStore, useRideMemo } from '@/features/ride/store';
import { startRide } from '@/features/ride/WhereToBar';
import { useMyLocationSpot } from '@/features/ride/WhereParts';
import { BottomPanel } from '@/features/track/Panels';
import { useTracking } from '@/features/track/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { goHomeStep, homeOf } from './logic';
import { useSimpleMode } from './pref';
import { useActiveRide } from './queries';

/**
 * Home switches here with one line (see `pref.ts`): put `<SimpleHomeRedirect />` anywhere in the
 * tree `app/(tabs)/index.tsx` returns. It draws nothing; with «الوضع البسيط» on and someone signed
 * in, it replaces home with `/simple`.
 */
export function SimpleHomeRedirect() {
  const simple = useSimpleMode();
  const signedIn = useSignedIn();
  return simple.on && signedIn ? <Redirect href="/simple" /> : null;
}

/**
 * The simple home (ride idea v2): «هلا أبو علي», his ride in progress as one big card, then at most
 * four big choices — «رجعني للبيت» (a taxi from where he is to his saved home, straight to the fares
 * with one confirm; no saved home → saved first, simply), «تكسي», «تكتك», and «مساعدة» (the help page,
 * as from the account page). The type is the scale's largest steps and grows with the phone's text
 * size without a cap; each choice is at least 88 px tall. «رجّع الشاشة العادية» turns it off.
 */
export function SimpleHome() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const simple = useSimpleMode();
  const me = useMe();
  const prof = useProfile();
  const { sources } = useRideSpots();
  const home = homeOf(sources.saved);
  const here = useMyLocationSpot();
  const active = useActiveRide();
  const [askHome, setAskHome] = useState(false);
  const firstName = (me.data?.name ?? prof.name)?.trim().split(/\s+/)[0] ?? null;

  const goHome = async () => {
    if (!home) {
      setAskHome(true);
      return;
    }
    const step = goHomeStep(home, await here.locate());
    if (step.kind === 'book') {
      rideStore.start('taxi');
      rideStore.update({ pickup: step.pickup, dropoff: step.home });
      router.push('/ride/choose');
    } else if (step.kind === 'at_home') {
      toast.show({ message: t('simple.at_home'), tone: 'info', icon: 'home' });
    } else if (step.kind === 'ask_pickup') {
      // No good fix: the where-to screen with home already set, asking where to pick him up.
      toast.show({ message: t('simple.no_fix'), tone: 'warning', icon: 'location-arrow' });
      rideStore.start('taxi');
      rideStore.update({ dropoff: step.home });
      router.push({ pathname: '/ride', params: { field: 'pickup' } });
    } else setAskHome(true);
  };

  const backToNormal = () => {
    void simple.set(false);
    toast.show({ message: t('account.simple_off'), tone: 'info' });
    router.replace('/');
  };

  return (
    <>
      <Screen
        testID="simple-home"
        contentStyle={{ gap: theme.space[5], paddingBottom: theme.space[8] }}
      >
        <View style={{ gap: theme.space[1], paddingTop: theme.space[2] }}>
          <Text variant="display" accessibilityRole="header" testID="simple-hello">
            {firstName ? t('simple.hello', { name: firstName }) : t('simple.hello_anon')}
          </Text>
          <Text variant="title" weight={500} color="textMuted">
            {t('simple.ask')}
          </Text>
        </View>

        {active.data ? <ActiveRideCard order={active.data} /> : null}

        <View style={{ gap: theme.space[3] }}>
          <BigChoice
            testID="simple-go-home"
            primary
            icon="home"
            title={t('ride.back_home')}
            sub={
              here.busy
                ? t('simple.locating')
                : home
                  ? t('ride.back_home_sub_here')
                  : t('simple.home_unset')
            }
            busy={here.busy}
            onPress={() => void goHome()}
          />
          <BigChoice
            testID="simple-taxi"
            icon="car"
            title={t('ride.vehicle_taxi')}
            sub={t('ride.vehicle_taxi_hint')}
            onPress={() => startRide('taxi')}
          />
          <BigChoice
            testID="simple-tuktuk"
            icon="tuktuk"
            title={t('ride.vehicle_tuktuk')}
            sub={t('ride.vehicle_tuktuk_hint')}
            onPress={() => startRide('tuktuk')}
          />
          <BigChoice
            testID="simple-help"
            icon="chat"
            title={t('simple.help_title')}
            sub={t('simple.help_sub')}
            onPress={() => router.push('/help')}
          />
        </View>

        <Pressable
          testID="simple-normal"
          accessibilityRole="button"
          onPress={backToNormal}
          style={({ pressed }) => ({
            alignSelf: 'center',
            minHeight: 48,
            justifyContent: 'center',
            paddingHorizontal: theme.space[4],
            borderRadius: theme.radius.pill,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="bodyStrong" color="textMuted" style={{ textDecorationLine: 'underline' }}>
            {t('simple.normal')}
          </Text>
        </Pressable>
      </Screen>
      {askHome ? <SetHomePanel onClose={() => setAskHome(false)} /> : null}
    </>
  );
}

/** One big choice: an icon in a round well, the word in the largest type, one plain line under it. */
function BigChoice({
  icon,
  title,
  sub,
  primary = false,
  busy = false,
  onPress,
  testID,
}: {
  icon: IconName;
  title: string;
  sub: string;
  primary?: boolean;
  busy?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}، ${sub}`}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => {
        theme.haptic('medium');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[4],
        minHeight: primary ? 128 : 96,
        paddingVertical: theme.space[4],
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius['2xl'],
        backgroundColor: primary
          ? pressed
            ? withAlpha(c.accent, 0.85)
            : c.accent
          : pressed
            ? c.accentTint
            : c.surface,
        borderWidth: primary ? 0 : 1.5,
        borderColor: c.border,
        transform: [{ scale: pressed && !theme.reduceMotion ? 0.985 : 1 }],
      })}
    >
      <View
        style={{
          width: primary ? 72 : 60,
          height: primary ? 72 : 60,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? withAlpha(c.surface, 0.35) : c.accentTint,
        }}
      >
        {busy ? (
          <ActivityIndicator color={primary ? c.onAccent : c.accentText} />
        ) : (
          <Icon
            name={icon}
            size={primary ? 38 : 32}
            color={primary ? 'onAccent' : 'accentText'}
            strokeWidth={2}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={primary ? 'display' : 'heading'} color={primary ? 'onAccent' : 'text'}>
          {title}
        </Text>
        <Text
          variant="title"
          weight={500}
          color={primary ? 'onAccent' : 'textMuted'}
          testID={`${testID}-sub`}
        >
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

/** The ride in progress, big: what is happening, who is coming, one button into the live screen. */
function ActiveRideCard({ order }: { order: Order }) {
  const theme = useTheme();
  const t = useT();
  const memo = useRideMemo(order.id);
  const track = useTracking(order.id);
  const courier = track.data?.courier ?? null;
  const who = courier
    ? [courier.firstName ?? t('track.driver_fallback'), courier.vehicleLabel, courier.plate]
        .filter(Boolean)
        .join(' · ')
    : null;
  const open = () => router.push({ pathname: '/order/[id]', params: { id: order.id } });
  return (
    <View
      testID="simple-active-ride"
      style={{
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius['2xl'],
        backgroundColor: theme.colors.inverse,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.colors.accent,
            borderWidth: 2,
            borderColor: withAlpha(theme.colors.accent, 0.35),
          }}
        />
        <Text variant="title" weight={600} color="onInverseAccent">
          {t('simple.active_title')}
        </Text>
      </View>
      <Text
        variant="heading"
        color="onInverse"
        accessibilityLiveRegion="polite"
        testID="simple-active-status"
      >
        {t(liveStatusKey(order))}
      </Text>
      {who ? (
        <Text variant="title" weight={500} color="onInverse" testID="simple-active-driver">
          {who}
        </Text>
      ) : null}
      {memo ? (
        <Text variant="title" weight={500} color="onInverseMuted">
          {t('share.route', { from: memo.from, to: memo.to })}
        </Text>
      ) : null}
      <Button
        testID="simple-active-open"
        label={t('simple.active_open')}
        size="lg"
        fullWidth
        onPress={open}
      />
    </View>
  );
}

/**
 * No saved home yet: «وين بيتك؟» with two big answers — «أني بالبيت هسة» saves the phone's position as
 * البيت on the spot, or the usual place editor opens on البيت to point at it on the map (or for a son
 * or daughter to do it with him).
 */
function SetHomePanel({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const here = useMyLocationSpot();
  const save = useSavePlace();
  const busy = here.busy || save.isPending;

  const saveHere = async () => {
    const r = await here.locate();
    if (typeof r !== 'object' || r.weak) {
      toast.show({
        message: t(r === 'denied' ? 'error.location_denied' : 'error.location_weak'),
        tone: 'warning',
        icon: 'location-arrow',
      });
      return;
    }
    const input = toSaveInput(
      {
        ...EMPTY_PLACE_EDITOR,
        label: 'home',
        name: defaultPlaceName('home', t),
        pin: r.spot.pin,
        zoneId: r.spot.zoneId,
      },
      t,
    );
    if (!input) return;
    try {
      await save.mutateAsync(input);
      toast.show({ message: t('simple.set_home_saved'), tone: 'success', icon: 'home' });
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <BottomPanel onClose={onClose} testID="simple-set-home">
      <View style={{ gap: theme.space[2] }}>
        <Text variant="display" accessibilityRole="header">
          {t('simple.set_home_title')}
        </Text>
        <Text variant="title" weight={500} color="textMuted">
          {t('simple.set_home_body')}
        </Text>
      </View>
      <BigChoice
        testID="simple-set-home-here"
        primary
        icon="home"
        title={t('simple.set_home_here')}
        sub={busy ? t('simple.locating') : t('simple.set_home_here_sub')}
        busy={busy}
        onPress={() => void saveHere()}
      />
      <BigChoice
        testID="simple-set-home-map"
        icon="map-pin"
        title={t('simple.set_home_map')}
        sub={t('simple.set_home_map_sub')}
        onPress={() => {
          onClose();
          router.push({ pathname: '/places/new', params: { label: 'home' } });
        }}
      />
    </BottomPanel>
  );
}
