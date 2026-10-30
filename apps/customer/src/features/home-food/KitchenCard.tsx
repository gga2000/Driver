import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { RestaurantCard } from '@driver/contracts';
import { Icon, Text, usePressScale, useTheme } from '@driver/ui';
import Animated from 'react-native-reanimated';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import { useT } from '@/lib/i18n';
import { CountPill, Monogram, usePom } from './parts';

const PHOTO_H = 168;

/**
 * One home kitchen in the أكل بيت list (v3, Ali 2026-10-11 «love it»): her dish photo across the top,
 * her letter, the kitchen's name, minutes to the door and orders so far, the rating, and how many
 * dishes are ready now and how many take reservations. Closed, it says when it opens.
 */
export const KitchenCard = memo(function KitchenCard({ k }: { k: RestaurantCard }) {
  const theme = useTheme();
  const t = useT();
  const pom = usePom();
  const press = usePressScale(0.98);
  const home = k.home;
  const ready = home?.readyCount ?? 0;
  const reserve = home?.reserveCount ?? 0;
  const minutes = k.etaMinMinutes ?? k.prepMinMinutes;
  const meta = [t('home_food.minutes', { n: minutes }), k.rating ? t('home_food.orders_count', { n: k.rating.count }) : null].filter(Boolean).join(' · ');
  const readyLabel = t('home_food.ready_count', { n: ready });
  const reserveLabel = t('home_food.reserve_count', { n: reserve });
  return (
    <Animated.View style={press.style}>
      <Pressable
        testID={`home-kitchen-${k.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('home_food.kitchen_a11y', { name: k.name, rating: k.rating ? k.rating.avg.toFixed(1) : t('restaurant.rating_new'), ready: readyLabel, reserve: reserveLabel })}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push({ pathname: '/home-food/[id]', params: { id: k.id } })}
        style={{ borderRadius: theme.radius.tile, overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
      >
        <View style={{ height: PHOTO_H, opacity: k.open ? 1 : 0.72 }}>
          <FoodArt variant="hero" motif={motifForKitchen(k.tags, k.cuisine)} photoUrl={k.photoUrl} />
          {!k.open ? (
            <View style={{ position: 'absolute', top: theme.space[3], start: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], minHeight: 30 }}>
              <Icon name="clock" size={15} color="textMuted" />
              <Text variant="caption" weight={700} compact testID={`home-kitchen-closed-${k.id}`}>
                {k.opensAt ? t('home_food.closed_until', { time: k.opensAt }) : t('home_food.closed')}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4] }}>
          <Monogram letter={home?.monogram ?? k.name.slice(0, 1)} />
          <View style={{ flex: 1, gap: theme.space[2], minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="title" face="display" numberOfLines={1}>
                  {k.name}
                </Text>
                <Text variant="footnote" color="textMuted" tabular numberOfLines={1}>
                  {meta}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4 }}>
                <Icon name="star" size={16} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                <Text variant="label" weight={700} tabular>
                  {k.rating ? k.rating.avg.toFixed(1) : t('restaurant.rating_new')}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {ready > 0 ? <CountPill icon="food" tone="ready" label={readyLabel} /> : null}
              {reserve > 0 ? <CountPill icon="clock" tone="reserve" label={reserveLabel} /> : null}
              {ready === 0 && reserve === 0 ? (
                <Text variant="caption" color={pom.sub}>
                  {t('home_food.sold_out')}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});
