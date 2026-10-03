import { router } from 'expo-router';
import { useState } from 'react';
import { Button } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { EMPTY_PLACE, PlaceForm, type PlaceDraft } from '@/features/places/PlaceForm';
import { useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

export default function NewPlace() {
  const t = useT();
  const [place, setPlace] = useState<PlaceDraft>(EMPTY_PLACE);
  const save = async () => {
    const saved = await profile.addPlace({ ...place, note: place.note?.trim() || undefined });
    await profile.selectPlace(saved.id);
    router.back();
  };
  return (
    <Screen edges={['bottom']} footer={<Button label={t('action.save')} size="lg" fullWidth disabled={!place.zoneId} onPress={() => void save()} />}>
      <PlaceForm value={place} onChange={setPlace} />
    </Screen>
  );
}
