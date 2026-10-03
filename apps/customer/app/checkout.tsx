import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** STUB — the food-ordering milestone replaces this file with one-screen checkout (spec §3). */
export default function CheckoutStub() {
  const t = useT();
  return <PlaceholderScreen title={t('checkout.title')} icon="receipt" detail="/checkout" />;
}
