import { memo, useMemo, type RefObject } from 'react';
import type { View } from 'react-native';
import type { MenuItem } from '@driver/contracts';
import { IconButton } from '@driver/ui';
import { router } from 'expo-router';
import { DrinkGrid } from '@/features/doors/DrinkGrid';
import { useT } from '@/lib/i18n';
import { itemCount, itemsTotal, type CartModifier } from './cart';
import { CartBar } from './CartBar';
import { countIn, useCartSelect, useCart, useItemCount } from './cart-store';
import { DishCard } from './DishCard';
import { stackThumbs } from './fly';
import type { Rect } from './FlyToCart';
import { artOf, type DishArt } from './FoodArt';
import type { Temperature } from './food-art';

/**
 * The menu's cart-aware pieces (perf t1). The restaurant screen itself doesn't read the cart: each
 * dish row reads its own count, so a «+» redraws one row and the cart bar instead of every dish and
 * its drawing. Handlers come in stable (made once by the screen) so the memoised rows can skip.
 */

export interface MenuActions {
  open: (item: MenuItem) => void;
  quickAdd: (item: MenuItem, from: Rect | null, chosen?: CartModifier[]) => void;
  removeOne: (item: MenuItem) => void;
}

export const LiveDishCard = memo(function LiveDishCard({
  merchantId,
  item,
  art,
  temperature,
  actions,
}: {
  merchantId: string;
  item: MenuItem;
  art: DishArt | undefined;
  temperature: Temperature | null;
  actions: MenuActions;
}) {
  const inCart = useItemCount(merchantId, item.id);
  return (
    <DishCard
      item={item}
      art={art}
      inCart={inCart}
      onOpen={() => actions.open(item)}
      onQuickAdd={(from) => actions.quickAdd(item, from)}
      onQuickAddWith={(mods, from) => actions.quickAdd(item, from, mods)}
      onDecrement={() => actions.removeOne(item)}
      temperature={temperature}
    />
  );
});

/** The café / juice grid with its own counts: only the six tiles' numbers are read. */
export function LiveDrinkGrid({
  merchantId,
  title,
  items,
  art,
  actions,
}: {
  merchantId: string;
  title: string;
  items: readonly MenuItem[];
  art: (item: MenuItem) => DishArt | undefined;
  actions: MenuActions;
}) {
  const key = useCartSelect((s) => items.map((i) => countIn(s.cart, merchantId, i.id)).join(','));
  const counts = useMemo(() => {
    const n = key.split(',').map(Number);
    return new Map(items.map((i, k) => [i.id, n[k] ?? 0]));
  }, [key, items]);
  return <DrinkGrid title={title} items={items} art={art} counts={counts} onOpen={actions.open} onQuickAdd={(i, from) => actions.quickAdd(i, from)} />;
}

/** The hero's basket button: shown while anything is in the cart, with the number of dishes. */
export function CartButton() {
  const t = useT();
  const count = useCartSelect((s) => (s.cart.lines.length > 0 ? itemCount(s.cart) : 0));
  if (count === 0) return null;
  return <IconButton icon="cart" variant="outline" badge={count} accessibilityLabel={t('cart.title')} onPress={() => router.push('/cart')} />;
}

/** The floating bar's contents (count, total, newest dishes); the screen decides when it shows. */
export function LiveCartBar({
  artById,
  photoById,
  bubbleRef,
  pulseKey,
}: {
  artById: ReadonlyMap<string, DishArt>;
  photoById: ReadonlyMap<string, string | null>;
  bubbleRef: RefObject<View | null>;
  pulseKey: number;
}) {
  const cart = useCart();
  const thumbs = useMemo(
    () => stackThumbs(cart).map((l) => ({ ...(artById.get(l.itemId) ?? artOf({ id: l.itemId, name: l.name })), photoUrl: photoById.get(l.itemId) ?? null })),
    [cart, artById, photoById],
  );
  return <CartBar count={itemCount(cart)} totalIqd={itemsTotal(cart)} thumbs={thumbs} bubbleRef={bubbleRef} pulseKey={pulseKey} onPress={() => router.push('/cart')} />;
}
