import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { CornerFill, LocalPhoto, Text, useTheme, useToast, withAlpha } from '@driver/ui';
import { TILE_PICTURES } from '@/features/home/tile-pictures';
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
        title={t('ride.ride_back_title')}
        price={price ? t('unit.iqd', { amount: price }) : null}
        sub={t('ride.ride_back_sub_noprice', { from: back.from.title })}
        loading={quote.isPending}
        onPress={() => book(back.from)}
      />
    );
  }
  return (
    <HomeCardRow
      testID="ride-take-me-home"
      title={t('ride.back_home')}
      price={from && price ? t('unit.iqd', { amount: price }) : null}
      sub={from ? t('ride.ride_back_sub_noprice', { from: from.title }) : t('ride.back_home_sub_here')}
      loading={Boolean(from) && quote.isPending}
      busy={here.busy}
      onPress={() => void goHome()}
    />
  );
}

/** The car's two headlights on the taxi picture's own 360 × 188 grid, and how far each one's light spreads. */
const LIGHTS = [
  { cx: 113, cy: 106, r: 30 },
  { cx: 18, cy: 95, r: 22 },
] as const;
/** The lights come on once, a moment after home opens, and stay on. */
const LIGHTS_DELAY_MS = 500;
const LIGHTS_MS = 700;

/**
 * The ride box (home roast 3, look D «the dark pass»): a date-brown box like the restaurant map box,
 * so it reads as the rider's own way home rather than another service card. The white Corolla waits
 * at the end side facing the words, its headlights coming on once; the price is the boldest thing in
 * it, in a taxi-yellow pill, with where the ride starts under it.
 */
function HomeCardRow({ testID, title, price, sub, loading, busy = false, onPress }: { testID: string; title: string; price: string | null; sub: string; loading: boolean; busy?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const ink = theme.services.trips;
  const taxi = theme.services.taxi;
  const car = TILE_PICTURES.taxi;
  // The car faces the reading direction's start side, towards the words (coming for you).
  const flip = car.faces !== (theme.isRTL ? 'right' : 'left');
  const p = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.03 * p.value }] }));
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)}>
      <Animated.View style={sink}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={[title, price, sub].filter((s): s is string => s !== null).join('، ')}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={() => {
            theme.haptic('selection');
            onPress();
          }}
          onPressIn={() => {
            if (!theme.reduceMotion) p.value = withSpring(1, theme.motion.spring.press);
          }}
          onPressOut={() => {
            p.value = withSpring(0, theme.motion.spring.select);
          }}
          style={{ minHeight: 104, justifyContent: 'center', borderRadius: theme.radius.xl, borderWidth: 1, borderColor: withAlpha(ink.on, 0.08), backgroundColor: ink.fill, overflow: 'hidden', opacity: busy ? 0.7 : 1 }}
        >
          <CornerFill base={ink.fill} light={ink.light} />
          <View pointerEvents="none" style={{ position: 'absolute', end: '-9%', top: 0, bottom: 0, width: '50%', justifyContent: 'center' }}>
            <View accessibilityIgnoresInvertColors style={{ width: '100%', aspectRatio: car.aspect, transform: flip ? [{ scaleX: -1 }] : undefined }}>
              <LocalPhoto source={car.source} fit="contain" style={{ width: '100%', height: '100%' }} />
              <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(LIGHTS_DELAY_MS).duration(LIGHTS_MS)} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
                <Svg width="100%" height="100%" viewBox="0 0 360 188">
                  <Defs>
                    <RadialGradient id="ride-home-light" cx="50%" cy="50%" r="50%">
                      <Stop offset="0" stopColor={taxi.card.top ?? taxi.card.bg} stopOpacity={0.95} />
                      <Stop offset="0.35" stopColor={taxi.fill} stopOpacity={0.45} />
                      <Stop offset="1" stopColor={taxi.fill} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  {LIGHTS.map((l, i) => (
                    <Circle key={i} cx={l.cx} cy={l.cy} r={l.r} fill="url(#ride-home-light)" />
                  ))}
                </Svg>
              </Animated.View>
            </View>
          </View>
          <View style={{ width: '58%', paddingVertical: theme.space[4], paddingStart: theme.space[5], gap: theme.space[2] }}>
            <Text variant="title" face="display" color={ink.on} numberOfLines={1}>
              {title}
            </Text>
            {loading ? (
              // The price on its way: the pill's shape in the box's own ink, not the cream skeleton.
              <View style={{ width: 112, height: 28, borderRadius: 14, backgroundColor: withAlpha(ink.on, 0.14) }} />
            ) : (
              <View style={{ alignItems: 'flex-start', gap: theme.space[1] }}>
                {price ? (
                  <View style={{ minHeight: 28, paddingHorizontal: theme.space[3], borderRadius: 14, justifyContent: 'center', backgroundColor: taxi.fill }}>
                    <Text variant="bodyStrong" color={taxi.on} tabular numberOfLines={1}>
                      {price}
                    </Text>
                  </View>
                ) : null}
                <Text variant="footnote" weight={500} color={withAlpha(ink.on, 0.72)} numberOfLines={2} testID={`${testID}-sub`}>
                  {sub}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
