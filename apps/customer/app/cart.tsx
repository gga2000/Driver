import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** STUB — the food-ordering milestone replaces this file with the cart (spec §3). */
export default function CartStub() {
  const t = useT();
  return <PlaceholderScreen title={t('cart.title')} icon="cart" detail="/cart" />;
}
