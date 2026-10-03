import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const t = useT();
  return <PlaceholderScreen title={t('error.generic')} icon="map-pin" />;
}
