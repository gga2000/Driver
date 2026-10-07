import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useHousehold, useSavePlace } from '@/features/account/queries';
import { defaultPlaceName, EMPTY_PLACE_EDITOR, PlaceEditor, toSaveInput, type PlaceEditorValue } from '@/features/account/PlaceEditor';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/**
 * Add a saved place (server-side, domain §7): pin, note, gate photo, household sharing. The ride
 * screens open it with a label (البيت/الشغل slots, ride idea w4) or with the place just ridden to
 * («تحب تسمّي هالمكان؟», ride idea a3); from there it saves without changing the deliver-to place.
 */
export default function NewPlace() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const household = useHousehold();
  const params = useLocalSearchParams<{ label?: string; lat?: string; lng?: string; zoneId?: string; from?: string }>();
  const fromRide = params.from === 'ride';
  const [value, setValue] = useState<PlaceEditorValue>(() => {
    const label = params.label === 'work' || params.label === 'custom' ? params.label : 'home';
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const pin = params.lat && params.lng && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    return { ...EMPTY_PLACE_EDITOR, label, name: label === 'custom' ? '' : defaultPlaceName(label, t), pin, zoneId: pin ? (params.zoneId ?? null) : null };
  });
  const save = useSavePlace();
  const input = toSaveInput(value, t);

  const submit = async () => {
    if (!input) return;
    try {
      const saved = await save.mutateAsync(input);
      if (!fromRide) await profile.selectPlace(saved.id);
      toast.show({ message: t('place.saved'), tone: 'success' });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="place-new"
      footer={<Button testID="place-save" label={t('action.save')} size="lg" fullWidth disabled={!input} loading={save.isPending} onPress={() => void submit()} />}
    >
      <PlaceEditor value={value} onChange={setValue} canShare={Boolean(household.data)} />
    </Screen>
  );
}
