import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { CornerFill, Icon, Skeleton, Text, usePressScale, useTheme, useToast, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { splitFare } from './home-card';
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

/**
 * The card's look (home roast 3, look B, Ali 2026-10-11): the taxi's own Soft Tint box with the words on
 * the start side and a little dashed road from you (or the place you went, the refresh mark) to a round
 * house button at the end, the fare riding on the road. It sinks a little under the finger, like the
 * service tiles above it.
 */
function HomeCardRow({ testID, icon, title, sub, loading, busy = false, onPress }: { testID: string; icon: 'home' | 'refresh'; title: string; sub: string; loading: boolean; busy?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const card = theme.services.taxi.card;
  const press = usePressScale();
  const [place, fare] = splitFare(sub);
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)} style={press.style}>
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
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 76,
          paddingVertical: theme.space[3],
          paddingStart: theme.space[5],
          paddingEnd: theme.space[3],
          backgroundColor: card.bg,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: withAlpha(card.on, 0.07),
          overflow: 'hidden',
        }}
      >
        {card.top ? <CornerFill base={card.bg} light={card.top} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="title" face="display" color={card.on} numberOfLines={2}>
            {title}
          </Text>
          {loading ? (
            <Skeleton width={150} height={14} />
          ) : (
            <Text variant="footnote" weight={500} color={card.sub} tabular numberOfLines={2} testID={`${testID}-sub`}>
              {place}
            </Text>
          )}
        </View>
        <Road from={icon} fare={loading ? null : fare} testID={`${testID}-fare`} />
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card.on }}>
          <Icon name="home" size={21} color={card.top ?? card.bg} strokeWidth={2.25} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** How long the road takes to draw, and how long it waits for the box to rise first. */
const ROAD_MS = 700;
const ROAD_DELAY_MS = 220;

/**
 * The little road, drawn at its real size in reading order (the drawing is made left to right and turned
 * for Arabic). It draws itself once from the start as the box appears, a window sliding open over a
 * drawing that slides the other way so it seems to stay put (transforms only); then it stays still. The
 * fare fades in as the road reaches it. Reduced motion shows it drawn.
 */
function Road({ from, fare, testID }: { from: 'home' | 'refresh'; fare: string | null; testID: string }) {
  const theme = useTheme();
  const card = theme.services.taxi.card;
  const [w, setW] = useState(0);
  const p = useSharedValue(theme.reduceMotion ? 1 : 0);
  const measured = w > 0;
  useEffect(() => {
    if (measured && !theme.reduceMotion) p.value = withDelay(ROAD_DELAY_MS, withTiming(1, { duration: ROAD_MS, easing: Easing.out(Easing.cubic) }));
  }, [measured, theme.reduceMotion, p]);
  const opening = useAnimatedStyle(() => ({ transform: [{ translateX: -w * (1 - p.value) }] }));
  const drawing = useAnimatedStyle(() => ({ transform: [{ translateX: w * (1 - p.value) }] }));
  const d = `M10 30 C ${w * 0.32} 30, ${w * 0.36} 13, ${w * 0.6} 15 S ${w * 0.86} 25, ${w} 22`;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: '19%', minWidth: 60, height: 44 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {measured ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, overflow: 'hidden', transform: [{ scaleX: theme.isRTL ? -1 : 1 }] }}>
          <Animated.View style={[{ flex: 1, overflow: 'hidden' }, opening]}>
            <Animated.View style={drawing}>
              <Svg width={w} height={44}>
                <Path d={d} stroke={withAlpha(card.on, 0.1)} strokeWidth={8} strokeLinecap="round" fill="none" />
                <Path d={d} stroke={card.dot} strokeWidth={2} strokeDasharray="4 6" strokeLinecap="round" fill="none" />
                {from === 'home' ? (
                  <>
                    <Circle cx={10} cy={30} r={9} fill={withAlpha(card.on, 0.14)} />
                    <Circle cx={10} cy={30} r={4.5} fill={card.on} />
                  </>
                ) : null}
              </Svg>
            </Animated.View>
          </Animated.View>
        </View>
      ) : null}
      {from === 'refresh' ? (
        <View style={{ position: 'absolute', start: -2, top: 20, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: card.on }}>
          <Icon name="refresh" size={13} color={card.top ?? card.bg} strokeWidth={2.4} />
        </View>
      ) : null}
      {fare ? (
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.delay(ROAD_DELAY_MS + ROAD_MS * 0.6).duration(ROAD_MS * 0.4)} style={{ position: 'absolute', top: -12, start: -8, end: -8, alignItems: 'center' }}>
          <View style={{ paddingHorizontal: theme.space[2], paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: card.on }}>
            <Text variant="caption" weight={700} color={card.top ?? card.bg} tabular numberOfLines={1} testID={testID}>
              {fare}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
