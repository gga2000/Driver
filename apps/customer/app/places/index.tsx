import { router } from 'expo-router';
import { Button, Card, Icon, ListRow } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { profile, selectedPlace, useProfile, zoneName } from '@/lib/profile';

/** "التوصيل لـ" picker: choose a saved place or add one. */
export default function PlacePicker() {
  const t = useT();
  const locale = useLocale();
  const prof = useProfile();
  const current = selectedPlace(prof);
  return (
    <Screen edges={['bottom']} footer={<Button testID="places-add" icon="plus" variant="secondary" label={t('home.add_place')} fullWidth onPress={() => router.push('/places/new')} />}>
      <Card elevation={0} padding={0}>
        {prof.places.length === 0 ? (
          <ListRow leading="map-pin" title={t('empty.saved_places')} subtitle={t('onboarding.place_hint')} />
        ) : (
          prof.places.map((p, i) => (
            <ListRow
              key={p.id}
              leading={p.label === 'home' ? 'home' : p.label === 'work' ? 'bag' : 'map-pin'}
              title={p.title ?? t(placeLabelKey(p.label))}
              subtitle={[zoneName(p.zoneId, locale), p.note].filter(Boolean).join(' · ')}
              selected={p.id === current?.id}
              trailing={p.id === current?.id ? <Icon name="check" size={20} color="accentText" strokeWidth={2.4} /> : undefined}
              chevron={false}
              divider={i < prof.places.length - 1}
              onPress={() => {
                void profile.selectPlace(p.id);
                router.back();
              }}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
