import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { longRideForHotFood, type CatalogSearchDish } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Icon, PhotoImage, Text, useTheme, withAlpha } from '@driver/ui';
import { DealSticker } from '@/features/food/DealBadge';
import { LongRide } from '@/features/food/RestaurantRow';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import type { FoodPhotoSource } from '@/features/food-landing/photos';

const PHOTO_H = 150;

/**
 * One of a door's «أحسن 3» as a photo card (Ali 2026-10-08, concept A): the dish (its own upload when
 * it has one, else a real photo of the kind), the one true reason it is here on the picture, the door
 * time, then the name, the dish and its price (or the cuisine) and the rating. A tap opens the kitchen,
 * on that dish when the pick came from a craving.
 */
export function PickCard({
  r,
  reason,
  photo,
  dish,
  cold,
  onOpen,
  testID,
}: {
  r: RestaurantSummary;
  reason: string;
  photo: FoodPhotoSource;
  dish?: CatalogSearchDish;
  cold?: boolean;
  onOpen?: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  const uri = dish && !failed ? apiPhoto(dish.photoUrl) : null;
  const time =
    r.etaMinMinutes !== null && r.etaMaxMinutes !== null
      ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale)
      : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale);
  const minutes = cold
    ? t('food.cold_minutes', { range: time })
    : t('list.minutes', { range: time });
  const dishLine = dish
    ? dish.kiloIqd
      ? t('food.dish_kilo', { dish: dish.name, amount: amountParam(dish.kiloIqd) })
      : t('food.dish_price', { dish: dish.name, amount: amountParam(dish.priceIqd) })
    : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[r.name, reason, dishLine ?? r.cuisine, minutes]
        .filter(Boolean)
        .join('، ')}
      onPress={() => {
        onOpen?.();
        router.push({
          pathname: '/restaurant/[id]',
          params: dish ? { id: r.id, item: dish.id } : { id: r.id },
        });
      }}
      style={({ pressed }) => ({
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ height: PHOTO_H, backgroundColor: theme.colors.inverse }}>
        {uri ? (
          <PhotoImage
            uri={uri}
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <FoodPhoto photo={photo} style={{ width: '100%', height: '100%' }} />
        )}
        <View
          testID={`${testID}-reason`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: theme.space[3],
            start: theme.space[3],
            maxWidth: '80%',
            paddingHorizontal: theme.space[3],
            paddingVertical: 4,
            borderRadius: theme.radius.pill,
            backgroundColor: withAlpha(theme.colors.inverse, 0.82),
          }}
        >
          <Text variant="caption" weight={700} color="onInverseAccent" numberOfLines={1}>
            {reason}
          </Text>
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: theme.space[3],
            end: theme.space[3],
            paddingHorizontal: theme.space[3],
            paddingVertical: 4,
            borderRadius: theme.radius.pill,
            backgroundColor: withAlpha(theme.colors.surface, 0.95),
          }}
        >
          <Text variant="caption" weight={700} tabular numberOfLines={1}>
            {minutes}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.name}
            </Text>
            {r.dealCount > 0 ? <DealSticker label={t('list.deal')} /> : null}
          </View>
          {dishLine ? (
            <Text variant="label" weight={600} tabular numberOfLines={1} testID={`${testID}-dish`}>
              {dishLine}
            </Text>
          ) : r.cuisine ? (
            <Text variant="label" color="textMuted" numberOfLines={1}>
              {r.cuisine}
            </Text>
          ) : null}
          {longRideForHotFood(r) ? <LongRide testID={`${testID}-long-ride`} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Icon
            name="star"
            size={14}
            color="starOutline"
            fillColor="star"
            filled
            strokeWidth={1.6}
          />
          <Text variant="label" weight={700} color="accentText" tabular>
            {r.rating === null ? t('list.new') : r.rating.toFixed(1)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
