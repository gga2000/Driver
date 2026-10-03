import { router } from 'expo-router';
import { ListRow } from '@driver/ui';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { zoneName, type SavedPlace } from '@/lib/profile';

/** "التوصيل لـ" row: the selected saved place (label · zone, courier note) → the places picker. */
export function DeliverToRow({ place, divider }: { place: SavedPlace | null; divider?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const title = place ? `${place.title ?? t(placeLabelKey(place.label))} · ${zoneName(place.zoneId, locale)}` : t('home.deliver_to_none');
  return (
    <ListRow
      testID="deliver-to"
      leading={place?.label === 'home' ? 'home' : 'map-pin'}
      title={title}
      subtitle={place?.note ?? t('checkout.change_place')}
      onPress={() => router.push('/places')}
      divider={divider}
    />
  );
}
