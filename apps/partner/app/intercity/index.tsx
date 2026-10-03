import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** Wave 2: garage board: announce departure, demand counts, walk-ups, PIN check-in. Replace this file's contents with the real screen. */
export default function IntercityBoard() {
  const t = useT();
  return <PlaceholderScreen title={t('partner.hub_intercity')} icon="garage" />;
}
