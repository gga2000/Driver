import { CartMenuPage } from '@/features/cart/CartMenuPage';
import { useCartMode } from '@/features/cart/queries';
import { MenuScreen } from '@/features/menu/MenuScreen';
import { useCurrentStore } from '@/features/store/queries';

/** المنيو — sections and dishes, availability, sold out today, search (src/features/menu); a food cart's own list (src/features/cart). */
export default function Menu() {
  const { store } = useCurrentStore();
  // Same query and cache as the orders tab's switch; while it loads or if it fails, the menu as before.
  const mode = useCartMode(store?.orgId ?? null);
  return mode.data?.cart ? <CartMenuPage back={false} /> : <MenuScreen />;
}
