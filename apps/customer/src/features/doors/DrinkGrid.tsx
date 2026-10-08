import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { IconButton, Icon, Text, useTheme } from '@driver/ui';
import { FoodArt, artOf, type DishArt } from '@/features/food/FoodArt';
import { measure, type Rect } from '@/features/food/FlyToCart';
import { canQuickAdd, fromPrice } from '@/features/food/modifiers';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

const COLS = 3;
const GAP = 10;

/**
 * A café's or juice bar's menu opens on pictures (idea m1): its six most ordered drinks — or, until a
 * shop has enough orders to say, its first six — as big tiles, three across, each with its price and a
 * +. The long list follows as usual. Tapping a tile opens the drink; the + adds it when there is
 * nothing to choose (and flies to the cart like every other add).
 */
export function DrinkGrid({
  title,
  items,
  art,
  counts,
  onOpen,
  onQuickAdd,
}: {
  title: string;
  items: readonly MenuItem[];
  art: (item: MenuItem) => DishArt | undefined;
  counts: ReadonlyMap<string, number>;
  onOpen: (item: MenuItem) => void;
  onQuickAdd: (item: MenuItem, from: Rect | null) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [width, setWidth] = useState(0);
  if (items.length < COLS) return null;
  const tile = width > 0 ? (width - GAP * (COLS - 1)) / COLS : 0;
  return (
    <View style={{ paddingTop: theme.space[5], gap: theme.space[3] }} testID="drink-grid">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="star" size={18} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {tile > 0 ? items.map((item) => <Tile key={item.id} item={item} size={tile} art={art(item)} inCart={counts.get(item.id) ?? 0} onOpen={() => onOpen(item)} onQuickAdd={(from) => onQuickAdd(item, from)} t={t} />) : null}
      </View>
    </View>
  );
}

function Tile({ item, size, art, inCart, onOpen, onQuickAdd, t }: { item: MenuItem; size: number; art: DishArt | undefined; inCart: number; onOpen: () => void; onQuickAdd: (from: Rect | null) => void; t: ReturnType<typeof useT> }) {
  const theme = useTheme();
  const locale = useLocale();
  const thumb = useRef<View>(null);
  const price = fromPrice(item);
  const soldOut = !item.available;
  return (
    <Pressable
      testID={`drink-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}، ${iqd(price.amount, { locale })}`}
      onPress={onOpen}
      style={({ pressed }) => ({ width: size, gap: 4, opacity: soldOut ? 0.55 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View ref={thumb} collapsable={false} style={{ width: size, height: size, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
        <FoodArt {...(art ?? artOf(item))} photoUrl={item.photoUrl} />
        {!soldOut ? (
          <IconButton
            testID={`drink-add-${item.id}`}
            icon="plus"
            size={36}
            variant={inCart > 0 ? 'accent' : 'outline'}
            accessibilityLabel={t('restaurant.add_item', { name: item.name })}
            onPress={canQuickAdd(item) ? () => void measure(thumb).then(onQuickAdd) : onOpen}
            style={{ position: 'absolute', bottom: 6, start: 6 }}
          />
        ) : null}
      </View>
      <Text variant="label" weight={600} numberOfLines={1}>
        {item.name}
      </Text>
      <Text variant="caption" color="textMuted" tabular>
        {price.varies ? t('restaurant.price_from', { amount: amountParam(price.amount) }) : iqd(price.amount, { locale })}
      </Text>
    </Pressable>
  );
}
