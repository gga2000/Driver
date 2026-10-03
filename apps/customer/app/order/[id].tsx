import { useLocalSearchParams } from 'expo-router';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/lib/i18n';

/** STUB — the live-order milestone replaces this file with the map + sheet screen (spec §4). */
export default function OrderStub() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaceholderScreen title={t('order.timeline_title')} icon="map-pin" detail={`/order/${id ?? ''}`} />;
}
