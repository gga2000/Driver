import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { CatalogSearchDish, DoorMoment } from '@driver/contracts';
import { Icon, PhotoImage, Text, useTheme, withAlpha } from '@driver/ui';
import { motifForDish } from '@/features/food/food-art';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { FoodPhoto } from './FoodPhoto';
import { photoForMotif } from './photos';

const GAP = 12;

/**
 * «عشا الليلة» (Ali 2026-10-08, C as the showcase): up to three real dishes for this hour from
 * kitchens open now, one big photo each, swiped sideways. One tap opens the dish ready to add, the
 * other the kitchen's menu. Never an ad: the same hour words home uses, nothing paid (g3/r5).
 */
export function Showcase({
  dishes,
  moment,
  kitchens,
  width,
}: {
  dishes: readonly CatalogSearchDish[];
  moment: DoorMoment;
  kitchens: readonly RestaurantSummary[];
  width: number;
}) {
  const theme = useTheme();
  const t = useT();
  const [page, setPage] = useState(0);
  const cardW = dishes.length > 1 ? width - 28 : width;
  if (dishes.length === 0) return null;
  return (
    <View testID="food-showcase" style={{ gap: theme.space[3] }}>
      <Text variant="title" weight={700} accessibilityRole="header">
        {t(`food.landing.tonight.${moment}`)}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + GAP}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={(e) => setPage(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / (cardW + GAP)))}
        scrollEventThrottle={64}
        style={{ marginHorizontal: -theme.space[5] }}
        contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: GAP }}
      >
        {dishes.map((d) => (
          <DishCard key={d.id} dish={d} kitchen={kitchens.find((k) => k.id === d.restaurantId) ?? null} width={cardW} />
        ))}
      </ScrollView>
      {dishes.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} aria-hidden accessible={false}>
          {dishes.map((d, i) => (
            <View key={d.id} style={{ height: 6, width: i === page ? 20 : 6, borderRadius: 3, backgroundColor: i === page ? theme.colors.accent : theme.colors.border }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DishCard({ dish, kitchen, width }: { dish: CatalogSearchDish; kitchen: RestaurantSummary | null; width: number }) {
  const theme = useTheme();
  const t = useT();
  const ink = theme.colors.inverse;
  const height = Math.round(Math.min(width * 1.08, 440));
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : apiPhoto(dish.photoUrl);
  const amount = amountParam(dish.priceIqd);
  const minutes = kitchen ? (kitchen.etaMaxMinutes ?? kitchen.prepMaxMinutes) : null;
  const openDish = () => router.push({ pathname: '/restaurant/[id]', params: { id: dish.restaurantId, item: dish.id } });
  return (
    <View style={{ width, height, borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: ink }}>
      <Pressable
        testID={`food-showcase-${dish.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('food.landing.showcase_a11y', { dish: dish.name, shop: dish.restaurantName, amount })}
        onPress={openDish}
        style={StyleSheet.absoluteFill}
      >
        {uri ? (
          <PhotoImage uri={uri} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
        ) : (
          <FoodPhoto photo={photoForMotif(motifForDish(dish.name))} style={{ width: '100%', height: '100%' }} />
        )}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={`show-${dish.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={ink} stopOpacity={0.3} />
                <Stop offset="0.25" stopColor={ink} stopOpacity={0} />
                <Stop offset="0.42" stopColor={ink} stopOpacity={0} />
                <Stop offset="0.92" stopColor={ink} stopOpacity={0.94} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#show-${dish.id})`} />
          </Svg>
        </View>
      </Pressable>

      {/* Who cooks it, and how they're rated. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: theme.space[3], start: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingVertical: 6, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.surface, 0.95) }}
      >
        <Text variant="label" weight={700} numberOfLines={1} style={{ maxWidth: width * 0.55 }}>
          {dish.restaurantName}
        </Text>
        {kitchen?.rating != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Icon name="star" size={13} color="star" />
            <Text variant="label" weight={700} tabular color="accentText">
              {kitchen.rating.toFixed(1)}
            </Text>
          </View>
        ) : null}
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], start: theme.space[4], end: theme.space[4] }}>
        <Text pointerEvents="none" variant="label" weight={700} color="onInverseAccent" numberOfLines={1}>
          {t('food.landing.showcase_from', { shop: dish.restaurantName })}
        </Text>
        <Text pointerEvents="none" weight={700} color="onInverse" numberOfLines={2} maxFontSizeMultiplier={1.25} style={{ fontSize: 28, lineHeight: 38, marginTop: 2 }}>
          {dish.name}
        </Text>
        {dish.description || minutes ? (
          <Text pointerEvents="none" variant="label" color={withAlpha(theme.colors.onInverse, 0.82)} numberOfLines={1} tabular>
            {[dish.description, minutes ? t('food.minutes', { n: minutes }) : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[3] }}>
          <Pressable
            testID={`food-showcase-order-${dish.id}`}
            accessibilityRole="button"
            onPress={() => {
              theme.haptic('selection');
              openDish();
            }}
            style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent, transform: [{ scale: pressed ? 0.98 : 1 }] })}
          >
            <Text variant="button" weight={700} color="onAccent" tabular numberOfLines={1}>
              {t('food.landing.showcase_order', { amount })}
            </Text>
          </Pressable>
          <Pressable
            testID={`food-showcase-menu-${dish.id}`}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: dish.restaurantId } })}
            style={({ pressed }) => ({ minHeight: 52, paddingHorizontal: theme.space[4], borderRadius: theme.radius.lg, flexDirection: 'row', alignItems: 'center', gap: theme.space[1], backgroundColor: withAlpha(theme.colors.onInverse, pressed ? 0.24 : 0.14), borderWidth: 1, borderColor: withAlpha(theme.colors.onInverse, 0.3) })}
          >
            <Text variant="button" weight={600} color="onInverse">
              {t('food.landing.showcase_menu')}
            </Text>
            <Icon name="chevron-forward" size={16} color="onInverse" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
