import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { doorOf, longRideForHotFood } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Icon, StatusPill, Text, usePressScale, useTheme, withAlpha } from '@driver/ui';
import { FoodArt, kitchenLook, motifForKitchen } from '@/features/food/FoodArt';
import { LongRide } from '@/features/food/RestaurantRow';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { doorSwatch } from './palette';
import { Shutter } from './Shutter';

const WINDOW = 84;
const AWNING = 22;
/** The awning's stripes in its own drawing units (the drawing stretches to the shop's width). */
const STRIPE = 20;
const AWNING_W = 360;

/** The striped awning with its scalloped hem, in the shop's door colour and the card's cream. */
const Awning = memo(function Awning({ colour, cream }: { colour: string; cream: string }) {
  const stripes = Array.from({ length: AWNING_W / STRIPE / 2 }, (_, i) => i * STRIPE * 2);
  let hem = `M0 ${AWNING - 6}`;
  for (let x = 0; x < AWNING_W; x += STRIPE) hem += ` q${STRIPE / 2} 12 ${STRIPE} 0`;
  return (
    <Svg width="100%" height={AWNING} viewBox={`0 0 ${AWNING_W} ${AWNING}`} preserveAspectRatio="none" aria-hidden accessible={false}>
      <Rect x={0} y={0} width={AWNING_W} height={AWNING - 6} fill={cream} />
      {stripes.map((x) => (
        <Rect key={x} x={x} y={0} width={STRIPE} height={AWNING - 6} fill={colour} />
      ))}
      <Path d={`${hem} Z`} fill={colour} />
    </Svg>
  );
});

/**
 * One shop on «سوق العزيزية» (Ali's Yes on p3): the full list drawn as a street of shopfronts. A striped
 * awning in the shop's door colour, its dish standing in an arched window, a lamp lit while it is open,
 * and the name, what it makes and its time written on the front. A closed shop has its shutter down and
 * says when it opens. Same facts as the plain row, so nothing is lost by walking the street.
 */
export function ShopFront({ r }: { r: RestaurantSummary }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const press = usePressScale();
  const door = doorOf(r.tags);
  const s = doorSwatch(theme, door);
  const time =
    r.etaMinMinutes !== null && r.etaMaxMinutes !== null
      ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale)
      : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  const closedLabel = r.opensAt ? t('list.closed_opens_at', { time: r.opensAt }) : t('list.closed');
  const lamp = theme.colors.star;
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID={`shop-front-${r.id}`}
        accessibilityRole="button"
        accessibilityLabel={[r.name, r.cuisine, r.open ? t('list.minutes', { range: time }) : closedLabel].filter(Boolean).join('، ')}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: r.id } })}
        style={{
          borderRadius: theme.radius.tile,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: r.open ? 1 : 0.92,
        }}
      >
        <Awning colour={r.open ? s.fill : theme.colors.borderStrong} cream={theme.colors.surface} />
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', padding: theme.space[3], paddingTop: theme.space[2] }}>
          <View style={{ width: WINDOW, alignItems: 'center' }}>
            {/* The lamp over the window: lit while the shop is open. */}
            <View
              style={[
                { width: 10, height: 10, borderRadius: 5, marginBottom: 4, backgroundColor: r.open ? lamp : theme.colors.surfaceSunken },
                r.open && theme.scheme === 'light' ? { boxShadow: `0px 0px 10px 4px ${withAlpha(lamp, 0.45)}` } : null,
              ]}
            />
            <View
              testID={`shop-front-${r.id}-window`}
              style={{
                width: WINDOW,
                height: WINDOW,
                borderTopStartRadius: WINDOW / 2,
                borderTopEndRadius: WINDOW / 2,
                borderBottomStartRadius: theme.radius.sm,
                borderBottomEndRadius: theme.radius.sm,
                borderWidth: 3,
                borderColor: r.open ? s.fill : theme.colors.borderStrong,
                overflow: 'hidden',
                backgroundColor: s.inner,
              }}
            >
              <FoodArt motif={motifForKitchen(r.tags, r.cuisine)} look={kitchenLook(r.id)} stage={s.inner} photoUrl={null} />
              {r.open ? null : <Shutter size={WINDOW} />}
            </View>
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="title" weight={700} numberOfLines={1}>
              {r.name}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {r.cuisine}
            </Text>
            {r.open ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="star" size={13} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                  <Text variant="caption" weight={700} tabular>
                    {r.rating === null ? t('list.new') : r.rating.toFixed(1)}
                  </Text>
                </View>
                <Text variant="caption" color="textMuted">
                  ·
                </Text>
                <Text variant="caption" weight={600} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
                  {t('list.minutes', { range: time })}
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
                <StatusPill size="sm" tone="neutral" icon="clock" label={closedLabel} />
              </View>
            )}
            {r.open && longRideForHotFood(r) ? <LongRide testID={`shop-front-${r.id}-long-ride`} /> : null}
          </View>
        </View>
        {/* The pavement in front of the shop. */}
        <View style={{ height: 8, backgroundColor: theme.colors.surfaceSunken }} />
      </Pressable>
    </Animated.View>
  );
}
