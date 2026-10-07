import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { decodeRideEnd } from '@driver/contracts';
import { Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { isRideVertical, spotForEnd } from '@/features/ride/logic';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { useLocale, useT } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';

/**
 * «نفس مشوار البارحة؟» (step 4, o4): the push opens `driver://ride/again?from=…&to=…&v=…&door=…`.
 * Fills the booking with the same pickup, drop-off, vehicle and door choice — named as the rider's
 * own places where they match — and opens the choose screen with a fresh server quote. Nothing is
 * requested until he taps. A link that is not ours goes to the normal «وين رايح؟».
 */
export default function RideAgain() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const params = useLocalSearchParams<{ from?: string; to?: string; v?: string; door?: string }>();
  const ride = useRideStore();
  const prof = useProfile();
  const { sources, landmarksLoading } = useRideSpots();
  const done = useRef(false);
  const ready = ride.loaded && prof.loaded && !landmarksLoading;

  useEffect(() => {
    if (done.current) return;
    const from = decodeRideEnd(params.from);
    const to = decodeRideEnd(params.to);
    if (!from || !to || !isRideVertical(params.v)) {
      done.current = true;
      router.replace('/ride');
      return;
    }
    if (!ready) return;
    done.current = true;
    const lang = locale === 'en' ? 'en' : 'ar-IQ';
    rideStore.start(params.v);
    rideStore.update({ pickup: spotForEnd(from, sources, lang), dropoff: spotForEnd(to, sources, lang), doorPickup: params.door === '1' });
    router.replace({ pathname: '/ride/choose', params: { again: '1' } });
  }, [ready, params.from, params.to, params.v, params.door, sources, locale]);

  return (
    <Screen testID="ride-again" contentStyle={{ gap: theme.space[4], paddingTop: theme.space[6] }}>
      <Text variant="title" accessibilityLiveRegion="polite">
        {t('ride.again_loading')}
      </Text>
      <View style={{ gap: theme.space[3] }}>
        <Skeleton height={72} radius={theme.radius.xl} />
        <Skeleton height={120} radius={theme.radius.xl} />
      </View>
    </Screen>
  );
}
