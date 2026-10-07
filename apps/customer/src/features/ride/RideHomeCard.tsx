import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Icon, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { rideBackOffer, tooClose, type Spot } from './logic';
import { usePickQuote } from './queries';
import { rideStore, useLastRide } from './store';
import { useRideSpots } from './useSpots';
import { useMyLocationSpot } from './WhereParts';

/**
 * The ride card for the home screen (ride ideas w3 and a4), self-contained: drop it in, it decides.
 * Later the same day as a ride that didn't end at home, it offers the way back from that place with
 * the price («ترجع من نفس المكان؟»); otherwise «رجعني للبيت», a taxi home in one tap, straight to the
 * fares. Nothing shows until the rider has a saved home.
 */
export function RideHomeCard() {
  const t = useT();
  const toast = useToast();
  const { sources, defaultPickup } = useRideSpots();
  const last = useLastRide();
  const here = useMyLocationSpot();
  const home = sources.saved.find((s) => s.savedLabel === 'home') ?? null;
  const back = useMemo(
    () => rideBackOffer({ lastAt: last?.at ?? null, lastToHome: Boolean(last?.toHome), lastPlace: last?.dest ?? null, home, now: Date.now() }),
    [last, home],
  );
  // «رجعني للبيت» starts from the deliver-to place when that isn't home; from home itself, from the phone's position.
  const from = back?.from ?? (defaultPickup && home && !tooClose(defaultPickup, home) ? defaultPickup : null);
  const quote = usePickQuote(from, home);
  if (!home) return null;

  const book = (pickup: Spot) => {
    rideStore.start('taxi');
    rideStore.update({ pickup, dropoff: home });
    router.push('/ride/choose');
  };

  const goHome = async () => {
    if (from) {
      book(from);
      return;
    }
    const r = await here.locate();
    if (typeof r === 'object' && !r.weak && !tooClose(r.spot, home)) {
      book(r.spot);
      return;
    }
    if (typeof r === 'object' && tooClose(r.spot, home)) {
      toast.show({ message: t('ride.same_place'), tone: 'warning', icon: 'home' });
      return;
    }
    // No good fix: the where-to screen with home already set, asking where to pick up.
    rideStore.start('taxi');
    rideStore.update({ dropoff: home });
    router.push({ pathname: '/ride', params: { field: 'pickup' } });
  };

  const price = quote.data ? amountParam(quote.data.total) : null;
  if (back) {
    return (
      <HomeCardRow
        testID="ride-back-offer"
        icon="refresh"
        title={t('ride.ride_back_title')}
        sub={price ? t('ride.ride_back_sub', { from: back.from.title, amount: price }) : t('ride.ride_back_sub_noprice', { from: back.from.title })}
        loading={quote.isPending}
        onPress={() => book(back.from)}
      />
    );
  }
  return (
    <HomeCardRow
      testID="ride-take-me-home"
      icon="home"
      title={t('ride.back_home')}
      sub={from && price ? t('ride.back_home_sub', { from: from.title, amount: price }) : t('ride.back_home_sub_here')}
      loading={Boolean(from) && quote.isPending}
      busy={here.busy}
      onPress={() => void goHome()}
    />
  );
}

function HomeCardRow({ testID, icon, title, sub, loading, busy = false, onPress }: { testID: string; icon: 'home' | 'refresh'; title: string; sub: string; loading: boolean; busy?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}، ${sub}`}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 64,
          padding: theme.space[3],
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
        })}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
          <Icon name={icon} size={21} color="accentText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          {loading ? (
            <Skeleton width={150} height={14} />
          ) : (
            <Text variant="caption" color="textMuted" tabular numberOfLines={1} testID={`${testID}-sub`}>
              {sub}
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </Pressable>
    </Animated.View>
  );
}
