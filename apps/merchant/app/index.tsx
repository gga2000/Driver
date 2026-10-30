import { Board } from '@/features/board/Board';
import { CartMode } from '@/features/cart/CartMode';
import { useCartMode } from '@/features/cart/queries';
import { useCurrentStore } from '@/features/store/queries';

/** الطلبات — the orders board (src/features/board), or a food cart's own screen (src/features/cart). */
export default function OrdersScreen() {
  const { store } = useCurrentStore();
  const mode = useCartMode(store?.orgId ?? null);
  // One switch on the kind of store; daily-produce and bakery modes join here.
  switch (mode.data?.cart ? 'cart' : 'restaurant') {
    case 'cart':
      return <CartMode />;
    default:
      return <Board />;
  }
}
