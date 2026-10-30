import { CartMenuPage } from '@/features/cart/CartMenuPage';
import { MenuModeWait } from '@/features/cart/MenuModeWait';
import { useCartMode } from '@/features/cart/queries';
import { MenuScreen } from '@/features/menu/MenuScreen';
import { useCurrentStore } from '@/features/store/queries';

/** المنيو — sections and dishes, availability, sold out today, search (src/features/menu); a food cart's own list (src/features/cart). */
export default function Menu() {
  const { store } = useCurrentStore();
  // Same query and cache as the orders tab's switch: the menu's loading look while it loads, the menu as before if it fails.
  const mode = useCartMode(store?.orgId ?? null);
  return mode.isLoading ? <MenuModeWait /> : mode.data?.cart ? <CartMenuPage back={false} /> : <MenuScreen />;
}
