import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { AnimatedPressable, PhotoImage, Text, usePressScale, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { measure } from '@/features/food/FlyToCart';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { Counter, KEY, type BandBasket } from './DaypartBand';
import type { DishPhoto } from './DishGallery';
import type { HourDish } from './gallery';

/** The grid's photo height: a calm 4:3-ish plate on a 390 phone. */
const PHOTO_H = 120;

/**
 * «أكلات ثانية» under the gallery (concept C): more dishes for the hour in two columns, each a real
 * photo with its name, kitchen and price, flat on the page like the cards above (no boxes, no shadow).
 * The saffron + adds a dish with nothing to choose in one tap; anything else opens it on the menu.
 */
export function MoreDishes({ items, photos, basket, testID = 'home-more' }: { items: readonly HourDish[]; photos: readonly DishPhoto[]; basket: BandBasket; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  if (items.length < 2) return null;
  const rows: HourDish[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View testID={testID} style={{ gap: theme.space[3] }}>
      <SectionHeader big title={t('home.more_title')} />
      <View style={{ gap: theme.space[4] }}>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: theme.space[3] }}>
            {row.map((h, c) => (
              <Tile key={h.dish.id} h={h} photo={photos[r * 2 + c] ?? null} basket={basket} testID={`${testID}-${r * 2 + c}`} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Tile({ h, photo, basket, testID }: { h: HourDish; photo: DishPhoto | null; basket: BandBasket; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pic = useRef<View>(null);
  const press = usePressScale(0.97);
  const [failed, setFailed] = useState(false);
  const d = h.dish;
  const price = iqd(d.priceIqd, { locale });
  const uri = failed ? null : photo?.uri;
  const open = () => {
    theme.haptic('selection');
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };
  const add = () => {
    if (!d.quickAdd || !d.available) return open();
    void measure(pic).then((from) => basket.add(d, from));
  };
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <AnimatedPressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('home.band_dish_a11y', { dish: d.name, restaurant: d.restaurantName, price })}
        onPress={open}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[{ gap: 2 }, press.style]}
      >
        <View ref={pic} collapsable={false} style={{ height: PHOTO_H, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          {uri ? (
            <PhotoImage uri={uri} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
          ) : photo?.local != null ? (
            <FoodPhoto photo={photo.local} style={{ width: '100%', height: '100%' }} />
          ) : null}
        </View>
        <Text variant="label" weight={700} numberOfLines={1} style={{ marginTop: theme.space[2] }}>
          {d.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {d.restaurantName}
          </Text>
          <Text variant="label" face="display" weight={700} tabular numberOfLines={1}>
            {price}
          </Text>
        </View>
      </AnimatedPressable>
      <Counter dish={d.name} count={basket.countOf(d)} onAdd={add} onRemove={() => basket.remove(d)} testID={testID} place={{ top: PHOTO_H - KEY - 8, end: 8 }} />
    </View>
  );
}
